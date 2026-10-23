/**
 * Web shim for `yuzic-engine`.
 *
 * The engine is a native audio module. On the web the player is
 * `createEngineBackend.web.ts`, which drives an `HTMLAudioElement` directly, so
 * nothing here plays audio.
 *
 * The one thing still reached is the engine's client-certificate surface, from
 * `mtls/serverFetch.ts` and `mtls/useClientCertificate.ts`. A browser cannot
 * present a client certificate to `fetch`, so these are inert: `setClientCertificate`
 * is a no-op and `clientCertificateRequest` rejects by name, exactly the way
 * the engine rejects an unimplemented method, so a call site that somehow
 * reached it fails legibly rather than as `is not a function`.
 */
class YuzicEngineStub {
  async setup(): Promise<void> {}
  async setClientCertificate(): Promise<void> {}
  async clearClientCertificate(): Promise<void> {}
  async clientCertificateRequest(): Promise<never> {
    throw new Error('clientCertificateRequest() is not implemented on web');
  }
}

export const YuzicEngine = new YuzicEngineStub();
export default { YuzicEngine };
