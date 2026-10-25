import { certificateRejected, probeFailure } from './addressProbe';
import { InsecureUrlError } from '@/providers/http/urlPolicy';

describe('certificateRejected', () => {
  it.each([
    // Android/OkHttp, the Caddy `tls internal` case in full.
    'java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.',
    'javax.net.ssl.SSLHandshakeException: Chain validation failed',
    'java.security.cert.CertificateException: Bad certificate',
    // iOS, NSURLErrorServerCertificateUntrusted.
    'The certificate for this server is invalid. You might be connecting to a server that is pretending to be "music.lan".',
    // OpenSSL-shaped.
    'unable to verify the first certificate',
    'self signed certificate in certificate chain',
    'CERT_HAS_EXPIRED',
    'ERR_CERT_AUTHORITY_INVALID',
  ])('reads %s as a refused certificate', message => {
    expect(certificateRejected(new Error(message))).toBe(true);
  });

  it.each([
    'Network request failed',
    'Unable to resolve host "music.lan": No address associated with hostname',
    'connect ECONNREFUSED 192.168.1.10:4533',
    'timeout of 10000ms exceeded',
  ])('leaves %s as an ordinary failure to reach anything', message => {
    expect(certificateRejected(new Error(message))).toBe(false);
  });

  it('reads the wording off a cause, since React Native wraps the native error', () => {
    const wrapped = new Error('Network request failed', {
      cause: new Error('Trust anchor for certification path not found.'),
    });

    expect(certificateRejected(wrapped)).toBe(true);
  });

  it('reads a thrown string', () => {
    expect(certificateRejected('SSLHandshakeException')).toBe(true);
  });

  it.each([null, undefined, 42, {}])('says no rather than throwing on %s', value => {
    expect(certificateRejected(value)).toBe(false);
  });

  it('does not loop on a cause that points at itself', () => {
    const looped: { message: string; cause?: unknown } = { message: 'Network request failed' };
    looped.cause = looped;

    expect(certificateRejected(looped)).toBe(false);
  });
});

describe('probeFailure', () => {
  it('names a refused certificate, so the user is not told to check an address that is right', () => {
    const error = new Error('Trust anchor for certification path not found.');

    expect(probeFailure(error)).toEqual({ kind: 'untrustedCertificate' });
  });

  it('still says unreachable for everything else', () => {
    expect(probeFailure(new TypeError('Network request failed'))).toEqual({ kind: 'unreachable' });
  });

  it('names a refused plain-HTTP public address', () => {
    expect(probeFailure(new InsecureUrlError('music.example.com'))).toEqual({ kind: 'insecure' });
  });
});
