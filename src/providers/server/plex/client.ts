import type { BasicAuth, CustomHeader } from '@/providers/contracts/Server';
import { customHeaderForRequest } from '@/providers/http/customHeader';
import { getInstallationId } from '@/providers/server/installationId';
import { tryWithFailover, orderedUrls } from '@/providers/http/urlFailover';
import { serverFetch } from '@/features/mtls/serverFetch';
import type { PlexResponse } from './types';
import { PlexRequestError } from './requestError';

type PlexClientConfig = {
  serverUrl: string;
  /** Stable identity lets API calls remember the last reachable endpoint. */
  serverId?: string;
  /** Extra LAN/Tailscale/public endpoints to try after the primary. */
  fallbackUrls?: string[];
  token?: string;
  basicAuth?: BasicAuth;
  /** Optional extra header sent on every server request, e.g. a proxy API key. */
  customHeader?: CustomHeader;
};

const PRODUCT = 'Yuzic';
const VERSION = '1.0.0';

function cleanBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * The `Authorization: Basic` header for a reverse proxy in front of a server,
 * or nothing when there is no Basic auth to send. The single construction of
 * this value — the base64 of `user:pass` — lives here so a stream/artwork
 * request built elsewhere reuses it rather than re-deriving credentials.
 */
export function plexBasicAuthHeader(basicAuth?: BasicAuth): Record<string, string> | undefined {
  if (!basicAuth) return undefined;
  return { Authorization: `Basic ${global.btoa(`${basicAuth.username}:${basicAuth.password}`)}` };
}

/**
 * Plex's server API is JSON when `Accept: application/json` is set. The
 * persistent client id is required by Plex and is deliberately the same
 * per-install identity MediaBrowser uses, never a launch-generated id.
 */
export function plexHeaders(
  token?: string,
  basicAuth?: BasicAuth,
  customHeader?: CustomHeader
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': VERSION,
    'X-Plex-Device': 'Mobile',
    'X-Plex-Client-Identifier': getInstallationId(),
  };
  if (token) headers['X-Plex-Token'] = token;
  // Custom first, then the app's own identity and credentials: a colliding
  // name must never displace the token this client was built around.
  return {
    ...customHeaderForRequest(customHeader),
    ...headers,
    ...plexBasicAuthHeader(basicAuth),
  };
}

export function createPlexClient(config: PlexClientConfig) {
  const baseUrl = cleanBaseUrl(config.serverUrl);
  const failoverHint = config.serverId
    ? { id: config.serverId, serverUrl: baseUrl, fallbackUrls: config.fallbackUrls }
    : null;
  const withFailover = <T,>(attempt: (url: string) => Promise<T>): Promise<T> =>
    failoverHint ? tryWithFailover(failoverHint, attempt) : attempt(baseUrl);
  const reachableBaseUrl = () => failoverHint ? orderedUrls(failoverHint)[0] ?? baseUrl : baseUrl;

  /** The response body as text, through failover unless `path` is already absolute. */
  async function send(path: string, init: RequestInit): Promise<string> {
    const attempt = async (url: string) => {
      const response = await serverFetch(`${url}${path}`, {
        ...init,
        headers: {
          ...plexHeaders(config.token, config.basicAuth, config.customHeader),
          ...init.headers,
        },
      });
      if (!response.ok) throw new PlexRequestError(response.status);
      return response.text();
    };
    return path.startsWith('http') ? attempt('') : withFailover(attempt);
  }

  /**
   * Plex answers a write (`/:/rate`, a playlist edit) with 200 and no body.
   * Parsing that as JSON threw, so a write the server had applied rejected.
   */
  async function request<T = PlexResponse>(path: string, init: RequestInit = {}): Promise<T> {
    const text = await send(path, init);
    return (text.trim() ? JSON.parse(text) : {}) as T;
  }

  /** A body that is not JSON — a lyrics stream's LRC or plain text. */
  function requestText(path: string, init: RequestInit = {}): Promise<string> {
    return send(path, init);
  }

  /** Direct-play path built from the part key preserved as Song.streamId. */
  function buildStreamUrl(partKey: string): string {
    if (!partKey) return '';
    const separator = partKey.includes('?') ? '&' : '?';
    const token = config.token ? `${separator}X-Plex-Token=${encodeURIComponent(config.token)}` : '';
    return `${reachableBaseUrl()}${partKey}${token}`;
  }

  function buildImageUrl(path?: string): string | null {
    if (!path) return null;
    const separator = path.includes('?') ? '&' : '?';
    const token = config.token ? `${separator}X-Plex-Token=${encodeURIComponent(config.token)}` : '';
    return `${reachableBaseUrl()}${path}${token}`;
  }

  return { baseUrl, request, requestText, buildStreamUrl, buildImageUrl };
}

export type PlexClient = ReturnType<typeof createPlexClient>;
