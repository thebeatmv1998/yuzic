/**
 * Where secrets live.
 *
 * Passwords, API keys, tokens and session keys go to the platform keystore —
 * Keychain on iOS, the Android Keystore — and never into Redux. Redux is
 * persisted to MMKV as plain JSON: readable on a rooted or jailbroken device,
 * swept up by any state dump, and carried into a crash report by whatever
 * serialises the store. A token stored there is a token disclosed.
 *
 * What Redux keeps is the part that is not secret: which servers exist, which
 * integrations are configured, and the *reference* under which each one's
 * secret is filed. A reference is derived, never stored, so the two can never
 * disagree about where a secret lives.
 *
 * Nothing here logs a value, and nothing returns one except to the caller that
 * asked for it by name.
 */
import * as SecureStore from 'expo-secure-store';

/** Who a secret belongs to. */
export type CredentialScope =
  /** A configured music server, keyed by `Server.id`. */
  | { kind: 'server'; serverId: string }
  /** An integration, keyed by its provider id. */
  | { kind: 'integration'; providerId: string };

/**
 * The named secrets a scope can hold. Listing them makes the set closed: a new
 * secret has to be declared here, which is where someone will notice it is a
 * secret at all.
 */
export type CredentialField =
  | 'password'
  | 'apiKey'
  | 'token'
  | 'sessionKey'
  /**
   * A reverse proxy's own password, in front of a server that also
   * authenticates. Its own field rather than borrowed from `apiKey`: a server
   * speaking password-or-token happens to leave that slot free today, but a
   * provider needing both would overwrite one secret with the other, and the
   * symptom would be an authentication failure with no wrong value in sight.
   */
  | 'proxyPassword'
  /**
   * The value of the server's optional custom request header. The name is not
   * secret and lives in the Server record; the value is a credential and gets
   * its own keystore entry, so renaming the header never rewrites a secret.
   */
  | 'customHeaderValue'
  /** Client certificate material for a server behind mTLS. */
  | 'clientCertificate'
  | 'clientCertificatePassword';

/**
 * SecureStore keys admit only alphanumerics and `._-`, so the scope's own id —
 * a nanoid or a provider literal — is encoded rather than trusted. An id that
 * needed escaping would otherwise collide with another scope's key.
 */
const encodeSegment = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, char => `_${char.charCodeAt(0).toString(16)}`);

export function credentialKey(scope: CredentialScope, field: CredentialField): string {
  const owner = scope.kind === 'server'
    ? `srv.${encodeSegment(scope.serverId)}`
    : `int.${encodeSegment(scope.providerId)}`;
  return `yuzic.cred.${owner}.${field}`;
}

/** Reads one secret. Null when it was never stored, or the keystore refused. */
export async function readCredential(
  scope: CredentialScope,
  field: CredentialField
): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(credentialKey(scope, field));
  } catch {
    // A locked or unavailable keystore is a real runtime state — a device
    // still booting, a user who has not unlocked yet. The caller treats it as
    // "not signed in" and asks again, which is the same path a missing
    // credential already takes. Deliberately not logged: the failure says
    // which secret was wanted.
    return null;
  }
}

/** Stores one secret. Writing an empty value deletes it rather than storing a blank. */
export async function writeCredential(
  scope: CredentialScope,
  field: CredentialField,
  value: string
): Promise<void> {
  const key = credentialKey(scope, field);
  if (!value) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    // The device must be unlocked at least once since boot. Background
    // playback resuming after a reboot needs the token before the user has
    // unlocked, and `WHEN_UNLOCKED` would deny it.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

async function deleteCredential(
  scope: CredentialScope,
  field: CredentialField
): Promise<void> {
  await SecureStore.deleteItemAsync(credentialKey(scope, field));
}

/**
 * Forgets every secret a scope holds, for when a server or integration is
 * removed. Each field is deleted explicitly: the keystore has no prefix scan,
 * so the closed `CredentialField` list is what makes this exhaustive.
 */
export async function deleteAllCredentials(scope: CredentialScope): Promise<void> {
  const fields: CredentialField[] = [
    'password', 'apiKey', 'token', 'sessionKey', 'proxyPassword',
    'customHeaderValue', 'clientCertificate', 'clientCertificatePassword',
  ];
  await Promise.all(fields.map(field => deleteCredential(scope, field)));
}

/** Reads several secrets at once, omitting the ones that are not stored. */
export async function readCredentials<F extends CredentialField>(
  scope: CredentialScope,
  fields: readonly F[]
): Promise<Partial<Record<F, string>>> {
  const entries = await Promise.all(
    fields.map(async field => [field, await readCredential(scope, field)] as const)
  );
  const out: Partial<Record<F, string>> = {};
  for (const [field, value] of entries) {
    if (value !== null) out[field] = value;
  }
  return out;
}
