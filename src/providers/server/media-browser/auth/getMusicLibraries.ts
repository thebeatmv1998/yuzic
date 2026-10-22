import { Server } from '@/providers/contracts/Server';
import { MediaBrowserItemsResponse } from '../types';
import { EMBY_BRAND, JELLYFIN_BRAND } from '../brand';
import { mediaBrowserAuthHeaders } from '../clientHeader';
import { customHeaderForRequest } from '@/providers/http/customHeader';
import { serverFetch } from '@/features/mtls/serverFetch';

export async function getMusicLibraries(server: Server): Promise<{ id: string; name: string }[]> {
  const { serverUrl, auth } = server;
  const token = auth?.token as string | undefined;
  const userId = auth?.userId as string | undefined;
  if (!serverUrl || !token || !userId) return [];

  try {
    // `X-Emby-Token` alone is the legacy form, and Jellyfin 12 stops reading
    // it — this ran during setup, so an upgraded server reported "no music
    // libraries" at exactly the moment a new user is deciding whether the app
    // works. The brand is derived from the server's own type rather than
    // threaded in, because this is the one call site that has a `Server` and
    // not a built client.
    const brand = server.type === 'emby' ? EMBY_BRAND : JELLYFIN_BRAND;
    const res = await serverFetch(`${serverUrl}/Users/${encodeURIComponent(userId)}/Views`, {
      headers: {
        ...customHeaderForRequest(server.customHeader),
        ...mediaBrowserAuthHeaders(brand, { token }),
      },
    });
    // A refused or errored response is not a server without music. Returning
    // an empty list here rendered a bad token, an expired session and an
    // unreachable host all as "this server has no music libraries" — during
    // setup, which is the worst possible place to be wrong about it.
    if (!res.ok) {
      throw new Error(`getMusicLibraries failed: HTTP ${res.status}`);
    }
    const data: MediaBrowserItemsResponse = await res.json();
    const items = data?.Items ?? [];
    return items
      .filter((i) => i.CollectionType === 'music')
      .map((i) => ({ id: String(i.Id), name: String(i.Name) }));
  } catch (error) {
    console.error('Jellyfin/Emby getMusicLibraries failed:', error);
    throw error;
  }
}
