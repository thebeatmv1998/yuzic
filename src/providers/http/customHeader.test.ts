import {
  customHeaderForRequest,
  hasCustomHeader,
  MAX_CUSTOM_HEADER_NAME_LENGTH,
  MAX_CUSTOM_HEADER_VALUE_LENGTH,
  validateCustomHeader,
} from './customHeader';

describe('validateCustomHeader', () => {
  it('treats two empty fields as "no header", not as an error', () => {
    expect(validateCustomHeader('', '')).toEqual({ ok: true, header: null });
  });

  it('accepts a normal API-key pair and trims surrounding whitespace', () => {
    expect(validateCustomHeader('  X-Api-Key  ', '  s3cret  ')).toEqual({
      ok: true,
      header: { name: 'X-Api-Key', value: 's3cret' },
    });
  });

  it('keeps a token that contains header-safe punctuation', () => {
    expect(validateCustomHeader('CF-Access-Client-Secret', 'abc+/=._~-123')).toEqual({
      ok: true,
      header: { name: 'CF-Access-Client-Secret', value: 'abc+/=._~-123' },
    });
  });

  it.each([
    ['', 'value', 'missingName'],
    ['X-Key', '', 'missingValue'],
    ['Bad Name', 'value', 'invalidName'],
    ['Bad:Name', 'value', 'invalidName'],
    ['Bad\r\nName', 'value', 'invalidName'],
    ['X-Key', 'line1\r\nX-Injected: yes', 'invalidValue'],
    ['X-Key', 'line1\nX-Injected: yes', 'invalidValue'],
    ['X-Key', 'nul\u0000byte', 'invalidValue'],
  ] as const)('rejects %p / %p as %s', (name, value, error) => {
    expect(validateCustomHeader(name, value)).toEqual({ ok: false, error });
  });

  it.each(['Host', 'host', 'Content-Length', 'Content-Type', 'Transfer-Encoding', 'Connection', 'Authorization', 'Cookie', 'Proxy-Authorization'])(
    'refuses the app-owned or framing header %s',
    (name) => {
      expect(validateCustomHeader(name, 'value')).toEqual({ ok: false, error: 'reservedName' });
    }
  );

  it('bounds both fields', () => {
    expect(validateCustomHeader('X'.repeat(MAX_CUSTOM_HEADER_NAME_LENGTH + 1), 'v')).toEqual({
      ok: false,
      error: 'tooLong',
    });
    expect(validateCustomHeader('X-Key', 'v'.repeat(MAX_CUSTOM_HEADER_VALUE_LENGTH + 1))).toEqual({
      ok: false,
      error: 'tooLong',
    });
  });
});

describe('customHeaderForRequest', () => {
  it('is an empty record when there is no header', () => {
    expect(customHeaderForRequest(undefined)).toEqual({});
    expect(customHeaderForRequest({ name: '' })).toEqual({});
  });

  it('fails closed for a half-written or invalid stored pair', () => {
    // A keystore entry with a name but no value must not become an empty
    // header; a hand-edited value must not become a malformed request.
    expect(customHeaderForRequest({ name: 'X-Key' })).toEqual({});
    expect(customHeaderForRequest({ name: 'X-Key', value: '' })).toEqual({});
    expect(customHeaderForRequest({ name: 'Bad Name', value: 'v' })).toEqual({});
    expect(customHeaderForRequest({ name: 'X-Key', value: 'a\r\nb' })).toEqual({});
  });

  it('returns the one header to spread into a request', () => {
    expect(customHeaderForRequest({ name: 'X-Key', value: 'v' })).toEqual({ 'X-Key': 'v' });
  });

  it('reports whether a complete pair is configured', () => {
    expect(hasCustomHeader(undefined)).toBe(false);
    expect(hasCustomHeader({ name: 'X-Key' })).toBe(false);
    expect(hasCustomHeader({ name: 'X-Key', value: 'v' })).toBe(true);
  });
});
