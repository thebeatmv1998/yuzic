/**
 * Where plain HTTP is still allowed.
 *
 * Yuzic deliberately supports a server on a home LAN over `http://` — a
 * self-hosted Navidrome at `192.168.1.10:4533` is a normal setup, and the
 * platform's cleartext switch exists for it. What is not normal is sending a
 * password, a session token or a custom auth header in clear text to a public
 * host. This module draws that line at the transport, so every API client
 * inherits it instead of each screen remembering to ask.
 *
 * The rule: HTTPS anywhere; HTTP only to a loopback, private, link-local,
 * CGNAT/Tailscale or single-label/local-suffix host. Unknown public hostnames
 * fail closed with an error the connect screens can report.
 */

export class InsecureUrlError extends Error {
  constructor(readonly host: string) {
    super(`Refusing plain HTTP to ${host}. Use HTTPS or a private network address.`);
    this.name = 'InsecureUrlError';
  }
}

const PRIVATE_SUFFIXES = ['.local', '.lan', '.home', '.internal', '.ts.net'];

/** `192.168.1.10` and friends. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  if (octets.some(octet => octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  // Unique-local fc00::/7 and link-local fe80::/10.
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true;
  }
  // IPv4-mapped addresses, e.g. ::ffff:192.168.1.10.
  const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/** Whether an HTTP request to this host stays on a trusted/local path. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return true;
  if (PRIVATE_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
  // A single-label name (`nas`, `music`) is resolved on the local network.
  return !host.includes('.');
}

/**
 * Throws for `http://` to a public host.
 *
 * Called at the two transports every server/integration request goes through
 * (`serverFetch` and `fetchWithTimeout`), so no client has to duplicate it.
 * HTTPS and local HTTP are untouched.
 */
export function assertAllowedUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Let fetch produce its own invalid-URL failure; this policy is about
    // transport, not URL syntax.
    return;
  }
  if (url.protocol !== 'http:') return;
  if (isPrivateHost(url.hostname)) return;
  throw new InsecureUrlError(url.hostname);
}

/**
 * A URL safe to put in an error message.
 *
 * Credentials in this app live in query strings for some protocols (Subsonic
 * `t`/`s`/`p`, Jellyfin `ApiKey`, Plex `X-Plex-Token`), so an error carrying
 * the full URL would write a replayable token into logcat or a crash report.
 * Origin and path are enough to tell the user which endpoint failed.
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.replace(/[?#].*$/, '');
  }
}
