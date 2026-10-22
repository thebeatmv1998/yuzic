import type { BasicAuth, CustomHeader, ProviderAuth, Server } from '@/providers/contracts/Server';
import { getCredentials, setCredential, forgetCredentials, type CredentialBundle } from '@/state/credentialCache';
import type { CredentialScope } from '@/state/credentials';
import { listenBrainzCredentialScope } from '@/state/redux/selectors/listenbrainzSelectors';
import { audiomuseCredentialScope } from '@/state/redux/selectors/audiomuseSelectors';
import { downloaderCredentialScope } from '@/state/redux/selectors/downloadersSelectors';
import { DOWNLOADER_IDS } from '@/state/redux/slices/downloadersSlice';

/**
 * A server's secrets: which of its fields are secret, where they live in the
 * keystore, and how a live `Server` is put back together from them for one
 * call. Redux never holds a password or token; this is the only place that
 * knows the split.
 */

/** Where one server's secrets live in the keystore. */
const serverCredentialScope = (serverId: string): CredentialScope => ({
  kind: 'server',
  serverId,
});

/**
 * Splits a freshly-connected provider's `auth` bag into what Redux may keep
 * (library scope ids, `userId`, ...) and the two keys that are secrets —
 * `password` (Navidrome's Subsonic password) and `token` (Jellyfin/Emby/Plex's
 * session token). Everything else passes through untouched.
 */
function splitSecretAuth(auth: ProviderAuth | undefined): {
  publicAuth: ProviderAuth;
  secrets: Partial<Record<'password' | 'token', string>>;
} {
  const publicAuth: ProviderAuth = {};
  const secrets: Partial<Record<'password' | 'token', string>> = {};
  for (const [key, value] of Object.entries(auth ?? {})) {
    if ((key === 'password' || key === 'token') && typeof value === 'string') {
      secrets[key] = value;
    } else {
      publicAuth[key] = value;
    }
  }
  return { publicAuth, secrets };
}

/**
 * Writes a newly-connected server's secrets to the keystore, each under its
 * own name: `auth.password`, `auth.token`, and a reverse proxy's own password
 * under `proxyPassword`. The proxy secret has a field of its own rather than
 * borrowing one that happens to be free, because a provider that needed both
 * would overwrite one with the other and fail to authenticate with no wrong
 * value anywhere in sight. Returns the sanitized `auth`/`basicAuth` that Redux
 * is allowed to store.
 */
export async function saveServerCredentials(
  serverId: string,
  auth: ProviderAuth | undefined,
  basicAuth: BasicAuth | undefined,
  customHeader?: CustomHeader
): Promise<{
  auth: ProviderAuth;
  basicAuth: BasicAuth | undefined;
  customHeader: CustomHeader | undefined;
}> {
  const { publicAuth, secrets } = splitSecretAuth(auth);
  const scope = serverCredentialScope(serverId);
  const [, , , sanitizedCustomHeader] = await Promise.all([
    secrets.password !== undefined ? setCredential(scope, 'password', secrets.password) : Promise.resolve(),
    secrets.token !== undefined ? setCredential(scope, 'token', secrets.token) : Promise.resolve(),
    basicAuth?.password ? setCredential(scope, 'proxyPassword', basicAuth.password) : Promise.resolve(),
    saveServerCustomHeader(serverId, customHeader),
  ]);
  return {
    auth: publicAuth,
    basicAuth: basicAuth ? { username: basicAuth.username } : undefined,
    customHeader: sanitizedCustomHeader,
  };
}

/**
 * Writes (or clears) one server's custom header value and returns the half
 * Redux may keep.
 *
 * Separate from `saveServerCredentials` because this is also what the Server
 * settings card calls when the header is changed long after onboarding: the
 * value goes to the keystore, the name goes into the `Server` record, and the
 * two are updated together so a rename cannot leave the old value behind.
 * Passing null (or a pair without a value) deletes the keystore entry rather
 * than storing an empty one.
 */
export async function saveServerCustomHeader(
  serverId: string,
  header: CustomHeader | null | undefined
): Promise<CustomHeader | undefined> {
  const scope = serverCredentialScope(serverId);
  const name = header?.name.trim();
  const value = header?.value?.trim();
  if (!name || !value) {
    await setCredential(scope, 'customHeaderValue', '');
    return undefined;
  }
  await setCredential(scope, 'customHeaderValue', value);
  return { name };
}

/**
 * Re-composes a live `Server` for one call: merges the non-secret Redux
 * record with the secrets `hydrateAll`/`setCredential` have put in
 * `credentialCache` (see `src/state/credentialCache.ts`). Never stored back —
 * this is built fresh for `createAdapter`, `listLibraries` and
 * `buildCoverUrl`, the three places a provider actually needs to
 * authenticate, and thrown away after.
 *
 * Before the startup keystore read lands, `getCredentials` returns `{}` and
 * this would return `server` with no secrets filled in. Nothing calls it in
 * that window: `CredentialsGate` holds the app back until the read is done.
 */
export function withServerCredentials(server: Server): Server {
  const creds: CredentialBundle = getCredentials(serverCredentialScope(server.id));
  const customHeaderValue = creds.customHeaderValue ?? server.customHeader?.value;
  return {
    ...server,
    auth: {
      ...server.auth,
      ...(creds.password !== undefined ? { password: creds.password } : {}),
      ...(creds.token !== undefined ? { token: creds.token } : {}),
    },
    // The inline fallbacks keep this idempotent: composing an already-composed
    // server (or a test fixture carrying its password directly) must not blank
    // a value just because the keystore has nothing under that id. A record
    // read from Redux never carries either value, so this adds no exposure.
    basicAuth: server.basicAuth
      ? {
          ...server.basicAuth,
          password: creds.proxyPassword ?? server.basicAuth.password ?? '',
        }
      : undefined,
    // No stored value means no header at all: sending the name with an empty
    // value would be a different request, and one no server asked for.
    customHeader:
      server.customHeader && customHeaderValue
        ? { ...server.customHeader, value: customHeaderValue }
        : undefined,
  };
}

/**
 * Every secret scope a server owns: its own, plus every per-server integration
 * keyed off it (ListenBrainz, AudioMuse, each downloader). Named without any
 * one provider in it deliberately: loading a server's secrets at launch and
 * forgetting them when it is removed both need all of it, and neither caller
 * should have to know which integrations exist. New per-server integrations
 * join the list here, not at the call sites.
 */
export function serverCredentialScopes(serverId: string): CredentialScope[] {
  return [
    serverCredentialScope(serverId),
    listenBrainzCredentialScope(serverId),
    audiomuseCredentialScope(serverId),
    ...DOWNLOADER_IDS.map(id => downloaderCredentialScope(id, serverId)),
  ];
}

/**
 * Forgets every secret a server owns, so removing a server doesn't leave the
 * keystore holding orphaned integration credentials under an id nothing
 * references any more.
 */
export async function forgetAllServerCredentials(serverId: string): Promise<void> {
  await Promise.all(serverCredentialScopes(serverId).map(forgetCredentials));
}
