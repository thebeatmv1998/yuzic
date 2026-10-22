import {
  customHeadersForRequest,
  MAX_CUSTOM_HEADERS,
  MAX_CUSTOM_HEADER_NAME_LENGTH,
  MAX_CUSTOM_HEADER_VALUE_LENGTH,
  MAX_CUSTOM_HEADERS_BYTES,
  parseStoredCustomHeaders,
  validateCustomHeader,
  validateCustomHeaders,
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

describe('validateCustomHeaders', () => {
  it('accepts an empty list and drops wholly blank rows', () => {
    expect(validateCustomHeaders([])).toEqual({ ok: true, headers: [] });
    expect(validateCustomHeaders([
      { name: '', value: '' },
      { name: 'X-Api-Key', value: 'one' },
      { name: '  ', value: '  ' },
      { name: 'X-User', value: 'ari' },
    ])).toEqual({
      ok: true,
      headers: [
        { name: 'X-Api-Key', value: 'one' },
        { name: 'X-User', value: 'ari' },
      ],
    });
  });

  it('reports the index of an invalid row', () => {
    expect(validateCustomHeaders([
      { name: 'X-Api-Key', value: 'one' },
      { name: 'Bad Name', value: 'two' },
    ])).toEqual({ ok: false, error: 'invalidName', index: 1 });
  });

  it('refuses two rows with the same name, whatever the case', () => {
    expect(validateCustomHeaders([
      { name: 'X-Api-Key', value: 'one' },
      { name: 'x-api-key', value: 'two' },
    ])).toEqual({ ok: false, error: 'duplicateName', index: 1 });
  });

  it('bounds the number of headers', () => {
    const rows = Array.from({ length: MAX_CUSTOM_HEADERS + 1 }, (_, i) => ({
      name: `X-Header-${i}`,
      value: 'v',
    }));
    expect(validateCustomHeaders(rows)).toEqual({ ok: false, error: 'tooManyHeaders' });
  });

  it('bounds the serialized list, because it is one keystore value', () => {
    const rows = [
      { name: 'X-One', value: 'a'.repeat(1000) },
      { name: 'X-Two', value: 'b'.repeat(1000) },
    ];
    expect(JSON.stringify(rows.map(({ name, value }) => ({ name, value }))).length)
      .toBeGreaterThan(MAX_CUSTOM_HEADERS_BYTES);
    expect(validateCustomHeaders(rows)).toEqual({ ok: false, error: 'tooLong' });
  });
});

describe('customHeadersForRequest', () => {
  it('is an empty record when there are no headers', () => {
    expect(customHeadersForRequest(undefined)).toEqual({});
    expect(customHeadersForRequest([])).toEqual({});
  });

  it('fails closed for a half-written or invalid stored pair', () => {
    // A keystore entry with a name but no value must not become an empty
    // header; a hand-edited value must not become a malformed request.
    expect(customHeadersForRequest([{ name: 'X-Key' }])).toEqual({});
    expect(customHeadersForRequest([{ name: 'X-Key', value: '' }])).toEqual({});
    expect(customHeadersForRequest([{ name: 'Bad Name', value: 'v' }])).toEqual({});
    expect(customHeadersForRequest([{ name: 'X-Key', value: 'a\r\nb' }])).toEqual({});
  });

  it('returns every header to spread into a request', () => {
    expect(customHeadersForRequest([
      { name: 'X-Api-Key', value: 'one' },
      { name: 'X-Authentik-Username', value: 'ari' },
    ])).toEqual({
      'X-Api-Key': 'one',
      'X-Authentik-Username': 'ari',
    });
  });
});

describe('parseStoredCustomHeaders', () => {
  it('reads the JSON array the keystore holds', () => {
    expect(parseStoredCustomHeaders('[{"name":"X-Key","value":"secret"}]')).toEqual([
      { name: 'X-Key', value: 'secret' },
    ]);
  });

  it('fails closed on a malformed or non-array entry', () => {
    expect(parseStoredCustomHeaders(undefined)).toEqual([]);
    expect(parseStoredCustomHeaders('not json')).toEqual([]);
    expect(parseStoredCustomHeaders('{"name":"X-Key","value":"secret"}')).toEqual([]);
    expect(parseStoredCustomHeaders('[{"name":"X-Key"},{"value":"v"},null]')).toEqual([]);
  });
});
