import type { AudioQuality } from '@/domain/playback/AudioFormat';
import type { CustomHeader } from '@/providers/contracts/Server';
import { customHeadersForRequest } from '@/providers/http/customHeader';
import { qualityToStreamParams } from '@/providers/server/streamQuality';
import { tryWithFailover, orderedUrls, UrlTimeoutError, isAbortError } from '@/providers/http/urlFailover';
import { serverProvenance, type Provenance } from '@/domain/identity/Provenance';
import { MediaBrowserBrand } from './brand';
import { playMethodForStreamFormat, type PlayMethod } from './playback/playMethod';
import { mediaBrowserAuthHeaders } from './clientHeader';
import { serverFetch } from '@/features/mtls/serverFetch';
import { MediaBrowserRequestError } from './requestError';

/** How long one URL gets to answer before failover moves on to the next. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface MediaBrowserClientConfig {
  /** Primary server URL. Used verbatim when no serverId/fallbackUrls given. */
  serverUrl: string;
  /** Server identity, needed to cache the last-known-good URL across requests. */
  serverId?: string;
  /** Extra URLs the failover layer tries after `serverUrl` (issue #115). */
  fallbackUrls?: string[];
  token: string;
  userId: string;
  parentId?: string;
  basicAuth?: { username: string; password?: string };
  /** Optional extra headers sent on every request, e.g. a proxy's API keys. */
  customHeaders?: CustomHeader[];
}

export type MediaBrowserClient = ReturnType<typeof createMediaBrowserClient>;

/**
 * `Provenance`, derived from `client.serverId` at the point every endpoint
 * already has a client in hand — the one place this adapter builds it, so
 * every mapper call in the folder gets the same record for the same server.
 *
 * A missing `serverId` here is not a data case a server can send: every real
 * adapter is constructed from `Server.id`, which is required. Inventing a
 * placeholder scope would silently merge that client's entities under one
 * shared bucket of `LocalId`s, which corrupts identity on-device far worse
 * than a thrown error during development.
 */
export function requireProvenance(client: Pick<MediaBrowserClient, 'serverId'>): Provenance {
  if (!client.serverId) {
    throw new Error(
      'MediaBrowser client has no serverId — cannot derive entity identity. ' +
      'This is a programming error: every adapter is constructed from Server.id.'
    );
  }
  return serverProvenance(client.serverId);
}

export function createMediaBrowserClient(config: MediaBrowserClientConfig, brand: MediaBrowserBrand) {
  const { serverUrl, serverId, fallbackUrls, token, userId, parentId, basicAuth, customHeaders } = config;
  const baseUrl = serverUrl.replace(/\/$/, "");
  const failoverHint = serverId
    ? { id: serverId, serverUrl: baseUrl, fallbackUrls }
    : null;
  const defaultHeaders: Record<string, string> = {
    // Custom first: the provider's identity/token headers are what make the
    // account work, so a colliding custom name must not displace them.
    ...customHeadersForRequest(customHeaders),
    ...mediaBrowserAuthHeaders(brand, {
      token,
      basicAuth,
    }),
  };

  // Was `X-Emby-Token` alone. That header is gated behind Jellyfin 12's
  // `EnableLegacyAuthorization` like the rest of the legacy set, so "token
  // only" now means the same credentials in whichever header the brand reads —
  // the distinction these two ever had was the client identity, and there is
  // no version where sending it costs anything.
  const tokenOnlyHeaders: Record<string, string> = defaultHeaders;

  async function callOne(url: string, path: string, headers: Record<string, string>, fetchOptions: RequestInit): Promise<Response> {
    const controller = new AbortController();
    // Whether *we* aborted. A bare AbortError cannot be told apart from a
    // cancellation, and failover has to know: a timed-out URL is one to give
    // up on and move past, a cancelled request is not. Reported as a
    // `UrlTimeoutError` so `isNetworkError` can say so without having to
    // treat every abort as a dead URL — see #263.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      return await serverFetch(`${url}${path}`, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      throw timedOut && isAbortError(error)
        ? new UrlTimeoutError(url, REQUEST_TIMEOUT_MS)
        : error;
    } finally {
      clearTimeout(timer);
    }
  }

  function withFailover<T>(attempt: (url: string) => Promise<T>): Promise<T> {
    return failoverHint
      ? tryWithFailover(failoverHint, attempt)
      : attempt(baseUrl);
  }

  async function request<T>(
    path: string,
    options: RequestInit & { tokenOnly?: boolean } = {}
  ): Promise<T> {
    const { tokenOnly, ...fetchOptions } = options;
    const headers = {
      ...(tokenOnly ? tokenOnlyHeaders : defaultHeaders),
      ...((fetchOptions.headers as Record<string, string>) ?? {}),
    };
    return withFailover(async (url) => {
      const res = await callOne(url, path, headers, fetchOptions);
      if (!res.ok) {
        throw new MediaBrowserRequestError(brand.label, res.status, await res.text());
      }
      if (res.status === 204 || res.headers.get("content-length") === "0") {
        return {} as T;
      }
      return res.json();
    });
  }

  async function requestText(
    path: string,
    options: RequestInit & { tokenOnly?: boolean } = {}
  ): Promise<string> {
    const { tokenOnly, ...fetchOptions } = options;
    const headers = {
      ...(tokenOnly ? tokenOnlyHeaders : defaultHeaders),
      ...((fetchOptions.headers as Record<string, string>) ?? {}),
    };
    return withFailover(async (url) => {
      const res = await callOne(url, path, headers, fetchOptions);
      if (!res.ok) {
        throw new Error(`${brand.label} API error (${res.status})`);
      }
      return res.text();
    });
  }

  /**
   * What was last asked of the server for each item, so the session reports
   * can say so honestly.
   *
   * Recorded where the decision is actually made. Nothing else knows it: the
   * report calls are handed an item id and a position, and the quality setting
   * that decides between the original bytes and a re-encode is read on the
   * other side of the app, in a hook, at the moment a queue is built.
   *
   * Bounded because a long session builds a URL for every track it queues, and
   * a map that only grows is a leak however small each entry is. Oldest out
   * first; an item that falls off reports the conservative default rather than
   * a stale answer.
   */
  const playMethods = new Map<string, PlayMethod>();
  const PLAY_METHOD_MEMORY = 200;

  function buildStreamUrl(songId: string, quality: AudioQuality = 'high', codec: 'mp3' | 'opus' = 'mp3'): string {
    // Streams pick up whichever URL failover has most recently confirmed alive:
    // a metadata request that just fell over to the fallback also moves the
    // stream URL onto that same address for the next `getPlayableUrl` call.
    const streamBaseUrl = failoverHint ? orderedUrls(failoverHint)[0] ?? baseUrl : baseUrl;
    const { format, maxBitRate } = qualityToStreamParams(quality);
    playMethods.delete(songId);
    playMethods.set(songId, playMethodForStreamFormat(format));
    while (playMethods.size > PLAY_METHOD_MEMORY) {
      const oldest = playMethods.keys().next();
      if (oldest.done) break;
      playMethods.delete(oldest.value);
    }
    if (format === 'raw') {
      return `${streamBaseUrl}/Audio/${songId}/stream?Static=true&${brand.streamTokenParam}=${token}`;
    }
    const bitrate = (maxBitRate ?? 320) * 1000;
    const ext = codec === 'opus' ? 'opus' : 'mp3';
    return `${streamBaseUrl}/Audio/${songId}/stream.${ext}?AudioCodec=${codec}&MaxStreamingBitrate=${bitrate}&${brand.streamTokenParam}=${token}`;
  }

  /**
   * How this item is being delivered, for a session report.
   *
   * `DirectPlay` when nothing was ever asked of this server for the item —
   * a track playing from a downloaded copy, or a queue recovered into a fresh
   * JavaScript context that has lost what it built. Both are cases where the
   * server is doing no work, which is exactly what `DirectPlay` claims.
   */
  function playMethodFor(songId: string): PlayMethod {
    return playMethods.get(songId) ?? 'DirectPlay';
  }

  function buildAvatarUrl(): string {
    const base = failoverHint ? orderedUrls(failoverHint)[0] ?? baseUrl : baseUrl;
    // The React Native Image loader cannot send the request headers used by
    // API calls. Carry the same brand-specific token that stream URLs use.
    // Without it, authenticated Jellyfin/Emby installations reject this image
    // even though the account request that produced the client succeeded.
    const params = new URLSearchParams({ [brand.streamTokenParam]: token });
    return `${base}/Users/${userId}/Images/Primary?${params}`;
  }

  return {
    request,
    requestText,
    serverUrl: baseUrl,
    /** Server identity used to build a stable `LocalId` for entities this client fetches. */
    serverId,
    token,
    userId,
    parentId,
    buildStreamUrl,
    playMethodFor,
    buildAvatarUrl,
    brand,
  };
}
