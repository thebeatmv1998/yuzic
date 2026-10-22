import type { Server } from '@/providers/contracts/Server';
import type { Provenance } from '@/domain/identity/Provenance';
import { SERVER_PROVIDERS } from '@/providers/registry/serverConnections';
import { withServerCredentials } from '@/providers/registry/serverCredentials';
import { customHeaderForRequest } from '@/providers/http/customHeader';

/**
 * The ephemeral request headers a track needs to be fetched, kept off the URL
 * and off any persisted Song/queue/cache. Audio and artwork are separate
 * fields because the engine fetches cover art independently of the stream and
 * wires each to a distinct `Track` field — see `mediaItem.ts` and the engine's
 * `Track.headers` / `Track.artworkHeaders`.
 */
export interface RequestHeaders {
  headers?: Record<string, string>;
  artworkHeaders?: Record<string, string>;
}

const EMPTY: RequestHeaders = {};

/**
 * Headers for one song against the active server.
 *
 * Two things can produce headers: a custom request header configured for the
 * server, and a provider that declares its own media auth — today Plex behind
 * a reverse proxy, which needs `Authorization: Basic` on the stream and the
 * artwork alike. Every other token/signed-URL server returns nothing, and is
 * left untouched. The same values cover both fetches, but are handed back
 * under the two distinct fields so the engine wires them independently.
 *
 * A song already resolved to a local `file://` path needs no credentials, so
 * it is skipped even on a Basic-auth Plex server. A song that names a different
 * provider than the active server (a mixed queue) is likewise skipped — its
 * credentials are not the ones we hold.
 *
 * A mixed queue is detected by the track's origin *server id*, not its server
 * type. That is strictly more precise: two Plex servers share a type, and the
 * credentials we hold for one are not the other's. The track's provenance says
 * which server it came from, so nothing has to be duplicated onto it.
 */
export function mediaHeadersForSong(
  server: Server | null | undefined,
  resource: { song?: { provenance?: Provenance }; streamUrl?: string }
): RequestHeaders {
  if (resource.streamUrl?.startsWith('file:')) return EMPTY;
  const provenance = resource.song?.provenance;
  // A track from a different origin than the active server carries none of
  // our credentials; one with no stated origin is assumed to be the active
  // server's, which is what every caller passing a bare URL means.
  if (provenance && (provenance.origin !== 'server' || provenance.serverId !== server?.id)) {
    return EMPTY;
  }
  if (!server) return EMPTY;
  // The Redux record carries the custom header's name but not its value; the
  // keystore copy is merged in for this call, the same way every API client is
  // built. `mediaAuthHeaders` then contributes whatever the provider itself
  // requires (Plex's proxy Basic auth today).
  const liveServer = withServerCredentials(server);
  const headers: Record<string, string> = {
    ...customHeaderForRequest(liveServer.customHeader),
    ...(SERVER_PROVIDERS[server.type]?.mediaAuthHeaders?.(liveServer) ?? {}),
  };
  if (Object.keys(headers).length === 0) return EMPTY;
  // The same header value covers both fetches, but is handed back under the
  // two distinct fields so the engine wires them independently.
  return { headers, artworkHeaders: headers };
}
