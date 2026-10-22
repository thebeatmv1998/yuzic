import type { CustomHeader } from '@/providers/contracts/Server';

/**
 * Validation for the configurable request headers a server may carry.
 *
 * The values are credentials as far as the app is concerned, so they are never
 * put in a URL, never logged, and never written to Redux. This module only
 * decides whether a list may be sent at all — storage is
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
/** More than an SSO gateway needs, few enough to stay reviewable in a sheet. */
export const MAX_CUSTOM_HEADERS = 8;

/**
 * A ceiling on the serialized list, not on an individual value.
 *
 * Expo SecureStore documents a 2048-byte value limit on Android; the whole
 * list is one keystore entry, so the budget is shared. 1900 leaves room for
 * JSON punctuation and the names, and is far more than a forward-auth setup
 * needs (two short identity headers, or one opaque token).
 */
export const MAX_CUSTOM_HEADERS_BYTES = 1900;

type CustomHeaderError =
  | 'missingName'
  | 'missingValue'
  | 'invalidName'
  | 'reservedName'
  | 'invalidValue'
  | 'tooLong'
  | 'duplicateName'
  | 'tooManyHeaders';

type CustomHeaderValidation =
  /** Every row was blank — there is simply no header. */
  | { ok: true; headers: { name: string; value: string }[] }
  | { ok: false; error: CustomHeaderError; index?: number };

/** One editable row: the name the user typed and the value they typed. */
type CustomHeaderInput = { name: string; value: string };

/** Control characters, CR/LF included: the header-injection surface. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/**
 * Whether one name/value pair may become a request header.
 *
 * Surrounding whitespace is trimmed: HTTP removes optional whitespace around
 * a field value in transit anyway, so a token that ended in a space could
 * never have matched on the server. An empty pair is valid and means "no
 * header", which is how a cleared settings row is saved.
 */
export function validateCustomHeader(
  name: string,
  value: string
): { ok: true; header: { name: string; value: string } | null } | { ok: false; error: CustomHeaderError } {
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
 * Validates a whole editable list.
 *
 * Wholly blank rows are dropped, so an empty last row in the UI is not an
 * error. A repeated name is refused: HTTP allows it for some fields, but two
 * values for an authentication header is a configuration mistake that would
 * be sent in an order nobody intended.
 */
export function validateCustomHeaders(
  rows: readonly CustomHeaderInput[]
): CustomHeaderValidation {
  const filled = rows.filter(row => row.name.trim() || row.value.trim());
  if (filled.length > MAX_CUSTOM_HEADERS) {
    return { ok: false, error: 'tooManyHeaders' };
  }

  const seen = new Set<string>();
  const headers: { name: string; value: string }[] = [];
  for (let index = 0; index < filled.length; index += 1) {
    const result = validateCustomHeader(filled[index].name, filled[index].value);
    if (!result.ok) return { ok: false, error: result.error, index };
    if (!result.header) continue;

    const key = result.header.name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: 'duplicateName', index };
    seen.add(key);
    headers.push(result.header);
  }

  // Serialized as stored, so this is the same budget the keystore enforces.
  if (JSON.stringify(headers).length > MAX_CUSTOM_HEADERS_BYTES) {
    return { ok: false, error: 'tooLong' };
  }
  return { ok: true, headers };
}

/**
 * The record to spread into a request's headers.
 *
 * Re-validates instead of trusting the stored pair: the keystore is the
 * record, and a hand-edited or half-written entry must fail closed (send
 * nothing) rather than become a malformed request. An absent or invalid pair
 * is skipped, so callers can spread unconditionally.
 */
export function customHeadersForRequest(
  headers: readonly CustomHeader[] | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (!header?.name) continue;
    const result = validateCustomHeader(header.name, header.value ?? '');
    if (!result.ok || !result.header) continue;
    out[result.header.name] = result.header.value;
  }
  return out;
}

/**
 * Reads the JSON array the keystore holds for `customHeaders`.
 *
 * Deliberately tolerant: an old or truncated entry yields no headers, which
 * is a failed authentication rather than a malformed request. Values are not
 * validated here — `customHeadersForRequest` does that at send time.
 */
export function parseStoredCustomHeaders(json: string | undefined): CustomHeader[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const name = (entry as { name?: unknown }).name;
      const value = (entry as { value?: unknown }).value;
      if (typeof name !== 'string' || typeof value !== 'string') return [];
      return [{ name, value }];
    });
  } catch {
    return [];
  }
}
