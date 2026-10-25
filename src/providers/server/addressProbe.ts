/**
 * What an address probe can conclude, and how it reads a thrown fetch.
 *
 * The three probes (Subsonic, Jellyfin/Emby, Plex) each ask their server's
 * public endpoint and each have to answer the same question, so the shape of
 * the answer and the one judgement call in it live here rather than three
 * times over.
 *
 * The judgement call is `certificateRejected`. A probe only ever sees a
 * thrown fetch, and every reason it might throw used to collapse into
 * `unreachable`: nothing listening, wrong port, DNS miss, and a certificate
 * the device refused all produced "Couldn't reach a server at this address."
 * That last one is not a wrong address, and telling the user to check the
 * address is advice that cannot work — on Android a private CA is refused
 * however right the address is, because the platform ignores user-installed
 * roots unless the app opts in (see `plugins/withUserCaTrust.js`). Someone
 * hitting this had no way to learn what was actually wrong.
 */

import { InsecureUrlError } from '@/providers/http/urlPolicy';

export type AddressProbe = {
  kind: 'ok' | 'unreachable' | 'notThisServer' | 'untrustedCertificate' | 'insecure';
};

/**
 * Fragments that mean "the certificate was refused", lowercased.
 *
 * Each platform words it differently and none of them expose a code through
 * `fetch`, so the message is all there is:
 *
 * - Android/OkHttp raises `SSLHandshakeException` wrapping
 *   `CertPathValidatorException: Trust anchor for certification path not
 *   found` — the Caddy-internal-CA case in full.
 * - iOS reports NSURLErrorServerCertificateUntrusted as "The certificate for
 *   this server is invalid".
 * - Anything OpenSSL-shaped underneath reports `CERT_`/`ERR_CERT_` codes or
 *   a self-signed complaint.
 */
const CERTIFICATE_FAILURES = [
  'trust anchor',
  'certpathvalidator',
  'certificateexception',
  'sslhandshake',
  'certificate',
  'self signed',
  'self-signed',
  'cert_',
  'err_cert',
];

/**
 * Whether a thrown fetch was the device refusing the server's certificate,
 * rather than the server not answering.
 *
 * Deliberately reads the whole chain: React Native wraps the native failure,
 * so the wording above is often on a `cause` rather than on the error itself.
 */
export function certificateRejected(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const message =
      typeof current === 'string'
        ? current
        : typeof (current as { message?: unknown }).message === 'string'
          ? ((current as { message: string }).message)
          : '';
    const haystack = message.toLowerCase();
    if (CERTIFICATE_FAILURES.some(fragment => haystack.includes(fragment))) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/** The verdict for a probe whose fetch threw. */
export function probeFailure(error: unknown): AddressProbe {
  if (error instanceof InsecureUrlError) return { kind: 'insecure' };
  return { kind: certificateRejected(error) ? 'untrustedCertificate' : 'unreachable' };
}
