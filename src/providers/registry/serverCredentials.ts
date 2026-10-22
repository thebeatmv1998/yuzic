import type { BasicAuth, CustomHeader, ProviderAuth, Server } from '@/providers/contracts/Server';
import { parseStoredCustomHeaders, validateCustomHeaders } from '@/providers/http/customHeader';
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
  customHeaders?: CustomHeader[]
): Promise<{
  auth: ProviderAuth;
  basicAuth: BasicAuth | undefined;
  customHeaders: CustomHeader[] | undefined;
}> {
  const { publicAuth, secrets } = splitSecretAuth(auth);
  const scope = serverCredentialScope(serverId);
  const [, , , sanitizedCustomHeaders] = await Promise.all([
    secrets.password !== undefined ? setCredential(scope, 'password', secrets.password) : Promise.resolve(),
    secrets.token !== undefined ? setCredential(scope, 'token', secrets.token) : Promise.resolve(),
    basicAuth?.password ? setCredential(scope, 'proxyPassword', basicAuth.password) : Promise.resolve(),
    saveServerCustomHeaders(serverId, customHeaders),
  ]);
  return {
    auth: publicAuth,
    basicAuth: basicAuth ? { username: basicAuth.username } : undefined,
    customHeaders: sanitizedCustomHeaders,
  };
}

/**
 * Writes (or clears) a server's custom header values and returns the halves
 * Redux may keep.
 *
 * Separate from `saveServerCredentials` because this is also what the Server
 * settings card calls when the headers are changed long after onboarding. The
 * JSON array — names and values together — is one keystore entry, bounded by
 * `MAX_CUSTOM_HEADERS_BYTES`; the Server record gets names only. The old
 * single-header entry is deleted on every save so an upgrade cannot leave a
 * stale secret behind.
 *
 * Validation is repeated here rather than trusted from the caller: this
 * function is the last place before a value is persisted, and storing a pair
 * that `customHeadersForRequest` will refuse would fail authentication later
 * with nothing to point at.
 */
export async function saveServerCustomHeaders(
  serverId: string,
  headers: CustomHeader[] | null | undefined
): Promise<CustomHeader[] | undefined> {
  const scope = serverCredentialScope(serverId);
  const rows = (headers ?? []).map(header => ({
    name: header.name ?? '',
    value: header.value ?? '',
  }));
  const result = validateCustomHeaders(rows);

  // An invalid list must never be a reason to wipe a working configuration.
  // Callers validate first, so reaching this is a bug; fail loudly instead.
  if (!result.ok) {
    throw new Error(`Invalid custom headers: ${result.error}`);
  }
  if (result.headers.length === 0) {
    await Promise.all([
      setCredential(scope, 'customHeaders', ''),
      setCredential(scope, 'customHeaderValue', ''),
    ]);
    return undefined;
  }

  await Promise.all([
    setCredential(scope, 'customHeaders', JSON.stringify(result.headers)),
    setCredential(scope, 'customHeaderValue', ''),
  ]);
  return result.headers.map(({ name }) => ({ name }));
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
  // The first fork release stored one header as a plain value. An install
  // upgrading from it has `customHeader` but no `customHeaders`; treating it
  // as a one-element list keeps that login working until the next save.
  const legacyHeader = server.customHeaders ? null : server.customHeader;
  const declared = server.customHeaders ?? (legacyHeader ? [legacyHeader] : []);
  const legacyValue = legacyHeader
    ? (creds.customHeaderValue ?? legacyHeader.value)
    : undefined;
  const storedHeaders = parseStoredCustomHeaders(creds.customHeaders);
  const customHeaders = declared.flatMap(header => {
    const stored = storedHeaders.find(
      candidate => candidate.name.toLowerCase() === header.name.toLowerCase()
    );
    const value = stored?.value ?? header.value ?? legacyValue;
    // No value means no header at all: sending the name with an empty value
    // would be a different request, and one no server asked for.
    return value ? [{ ...header, value }] : [];
  });
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
    customHeaders: customHeaders.length > 0 ? customHeaders : undefined,
    // The legacy single-header field is read above and never passed on; every
    // client now consumes `customHeaders`.
    customHeader: undefined,
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
