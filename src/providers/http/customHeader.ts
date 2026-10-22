import type { CustomHeader } from '@/providers/contracts/Server';

/**
 * Validation for the one configurable request header a server may carry.
 *
 * The value is a credential as far as the app is concerned, so it is never
 * put in a URL, never logged, and never written to Redux. This module only
 * decides whether a pair may be sent at all — storage is
 * `state/credentials.ts` and composition is `withServerCredentials`.
 *
 * Two attack shapes are refused rather than passed through:
 *
 * - **Header injection.** A name is an RFC 7230 token, not "anything before
 *   the colon"; a value carrying CR, LF or another control character would
 *   otherwise let a pasted string become a second header.
 * - **Requests the app cannot assemble.** `Host`, `Content-Length`,
 *   `Transfer-Encoding`, `Connection` and friends are the framing of the
 *   request, and `Content-Type` is chosen per call (a Subsonic form POST is
 *   not JSON). `Authorization` and `Cookie` are owned by the app — provider
 *   tokens and the proxy Basic-auth fields already live there — and letting a
 *   custom value silently win would make the visible credentials a lie.
 */

/** RFC 7230 `token`: the only thing a header name is allowed to be. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Headers the app sets itself, or that describe the request's framing. Sent
 * case-insensitively, so the check lowercases the name first.
 */
const RESERVED = new Set([
  'authorization',
  'connection',
  'content-encoding',
  'content-length',
  'content-type',
  'cookie',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Long enough for any real API key, short enough to bound one field. */
export const MAX_CUSTOM_HEADER_NAME_LENGTH = 128;
export const MAX_CUSTOM_HEADER_VALUE_LENGTH = 4096;

type CustomHeaderError =
  | 'missingName'
  | 'missingValue'
  | 'invalidName'
  | 'reservedName'
  | 'invalidValue'
  | 'tooLong';

type CustomHeaderValidation =
  /** Neither field was filled in — there is simply no header. */
  | { ok: true; header: null }
  /** Both halves are present; unlike `Server.customHeader`, the value is here. */
  | { ok: true; header: { name: string; value: string } }
  | { ok: false; error: CustomHeaderError };

/** Control characters, CR/LF included: the header-injection surface. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/**
 * Whether a name/value pair may become a request header.
 *
 * Surrounding whitespace is trimmed: HTTP removes optional whitespace around
 * a field value in transit anyway, so a token that ended in a space could
 * never have matched on the server. An empty pair is valid and means "no
 * header", which is how a cleared settings field is saved.
 */
export function validateCustomHeader(name: string, value: string): CustomHeaderValidation {
  const trimmedName = name.trim();
  const trimmedValue = value.trim();

  if (!trimmedName && !trimmedValue) return { ok: true, header: null };
  if (!trimmedName) return { ok: false, error: 'missingName' };
  if (!trimmedValue) return { ok: false, error: 'missingValue' };

  if (
    trimmedName.length > MAX_CUSTOM_HEADER_NAME_LENGTH ||
    trimmedValue.length > MAX_CUSTOM_HEADER_VALUE_LENGTH
  ) {
    return { ok: false, error: 'tooLong' };
  }
  if (!TOKEN.test(trimmedName)) return { ok: false, error: 'invalidName' };
  if (RESERVED.has(trimmedName.toLowerCase())) return { ok: false, error: 'reservedName' };
  if (CONTROL_CHARACTERS.test(trimmedValue)) return { ok: false, error: 'invalidValue' };

  return { ok: true, header: { name: trimmedName, value: trimmedValue } };
}

/**
 * The record to spread into a request's headers.
 *
 * Re-validates instead of trusting the stored pair: the keystore is the
 * record, and a hand-edited or half-written entry must fail closed (send
 * nothing) rather than become a malformed request. An absent or invalid pair
 * is an empty record, so callers can spread unconditionally.
 */
export function customHeaderForRequest(header: CustomHeader | undefined): Record<string, string> {
  if (!header?.name) return {};
  const result = validateCustomHeader(header.name, header.value ?? '');
  if (!result.ok || !result.header) return {};
  return { [result.header.name]: result.header.value };
}

/** Whether a stored pair is complete enough to send. Used by settings UI. */
export function hasCustomHeader(header: CustomHeader | undefined): boolean {
  return Object.keys(customHeaderForRequest(header)).length > 0;
}
