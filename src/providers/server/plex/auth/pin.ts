import { fetchWithTimeout } from '@/providers/http/fetchWithTimeout';
import { createPlexClient, plexHeaders } from '../client';
import type { PlexPinResponse } from '../types';
import type { BasicAuth, CustomHeader } from '@/providers/contracts/Server';
import { codeAuthServerError } from '@/providers/registry/codeAuthServerError';

const PLEX_ACCOUNT = 'https://plex.tv';

type PlexUserResponse = { username?: string; title?: string };

async function accountRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(`${PLEX_ACCOUNT}${path}`, {
    ...init,
    headers: { ...plexHeaders(undefined), ...init.headers },
  });
  if (!response.ok) throw new Error(`Plex account request failed (${response.status})`);
  return response.json() as Promise<T>;
}

/**
 * Plex PIN sign-in. The server URL is intentionally not sent to plex.tv: PIN
 * approval grants an account token, then the normal provider ping verifies
 * that token against the server the user selected.
 *
 * The PIN is deliberately **not** a strong one. Plex issues two kinds, and
 * `?strong=true` returns a 25-character opaque code meant to be carried inside
 * an `app.plex.tv/auth#?code=...` URL that the user never reads. The default
 * returns the four-character code that plex.tv/link accepts by hand. This flow
 * prints the code and asks the user to type it, so asking for the strong one
 * handed them something plex.tv/link has no field for — Plex sign-in could not
 * be completed at all, by anyone.
 */
export async function beginPlexPin(_serverUrl: string, _basicAuth?: BasicAuth) {
  const pin = await accountRequest<PlexPinResponse>('/api/v2/pins', { method: 'POST' });
  if (!pin.id || !pin.code) throw new Error('Plex did not return a sign-in code.');
  return { code: pin.code, handle: String(pin.id) };
}

export async function pollPlexPin(
  handle: string,
  serverUrl: string,
  basicAuth?: BasicAuth,
  customHeader?: CustomHeader
) {
  const pin = await accountRequest<PlexPinResponse>(`/api/v2/pins/${encodeURIComponent(handle)}`);
  if (!pin.authToken) return null;
  // Account approval proves only that Plex issued a token. The selected server
  // can still reject that account or sit behind a proxy, so verify a protected
  // server resource before onboarding persists an authenticated record.
  //
  // Past this point the approval has happened, so a failure here is the server
  // and not the code. It is marked, because the caller retries an unmarked
  // throw until the flow times out and blames the code for it.
  try {
    await createPlexClient({
      serverUrl,
      token: pin.authToken,
      basicAuth,
      customHeader,
    }).request('/library/sections');
    const user = await accountRequest<PlexUserResponse>('/api/v2/user', {
      headers: { 'X-Plex-Token': pin.authToken },
    });
    return { auth: { token: pin.authToken }, username: user.username ?? user.title ?? 'Plex' };
  } catch (err) {
    throw codeAuthServerError(err);
  }
}
