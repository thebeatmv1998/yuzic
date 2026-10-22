/**
 * The in-memory working copy of the keystore.
 *
 * Adapters are built synchronously — `useApi` turns the active server into a
 * client during render — while the keystore is asynchronous. Rather than make
 * every call site async, secrets are read once at startup into memory and
 * served from there.
 *
 * Memory is a cache, never the record. The keystore owns the values; this
 * holds a copy for the lifetime of the process and is never persisted,
 * serialised, or included in any state dump. Clearing it loses nothing.
 */
import {
  readCredentials,
  writeCredential,
  deleteAllCredentials,
  type CredentialField,
  type CredentialScope,
} from './credentials';

const FIELDS: readonly CredentialField[] = [
  'password', 'apiKey', 'token', 'sessionKey', 'proxyPassword',
  'customHeaderValue', 'clientCertificate', 'clientCertificatePassword',
];

export type CredentialBundle = Partial<Record<CredentialField, string>>;

const cache = new Map<string, CredentialBundle>();

const scopeKey = (scope: CredentialScope): string =>
  scope.kind === 'server' ? `srv:${scope.serverId}` : `int:${scope.providerId}`;

/**
 * Loads a scope's secrets into memory. Called once per scope at startup, and
 * again after credentials change.
 */
export async function hydrateCredentials(scope: CredentialScope): Promise<void> {
  cache.set(scopeKey(scope), await readCredentials(scope, FIELDS));
}

/** Loads several scopes in parallel, for app start. */
export async function hydrateAll(scopes: readonly CredentialScope[]): Promise<void> {
  await Promise.all(scopes.map(hydrateCredentials));
}

/**
 * The secrets for a scope, synchronously.
 *
 * Empty when nothing has been hydrated yet — which is a real state during the
 * first frames after launch, and reads the same as "not signed in". Callers
 * already handle that: an adapter without credentials fails its ping and the
 * app shows the disconnected path, then re-renders once hydration completes.
 */
export function getCredentials(scope: CredentialScope): CredentialBundle {
  return cache.get(scopeKey(scope)) ?? {};
}

/** Stores a secret and refreshes the cached copy in one step, so they cannot diverge. */
export async function setCredential(
  scope: CredentialScope,
  field: CredentialField,
  value: string
): Promise<void> {
  await writeCredential(scope, field, value);
  const key = scopeKey(scope);
  const next = { ...(cache.get(key) ?? {}) };
  if (value) next[field] = value;
  else delete next[field];
  cache.set(key, next);
}

/** Forgets a scope entirely, in the keystore and in memory. */
export async function forgetCredentials(scope: CredentialScope): Promise<void> {
  await deleteAllCredentials(scope);
  cache.delete(scopeKey(scope));
}

/** Drops the working copy without touching the keystore. Tests only. */
export function _clearCredentialCache(): void {
  cache.clear();
}
