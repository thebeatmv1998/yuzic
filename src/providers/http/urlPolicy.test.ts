import { assertAllowedUrl, InsecureUrlError, isPrivateHost, redactUrl } from './urlPolicy';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'music.localhost',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '169.254.1.1',
    '100.64.0.1',
    '100.127.255.254',
    '::1',
    'fd12:3456::1',
    'fe80::1',
    'nas',
    'music.local',
    'server.lan',
    'host.internal',
    'box.tailnet.ts.net',
  ])('accepts %s as local', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    'example.com',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '11.0.0.1',
    'music.example.com',
  ])('rejects %s as public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('assertAllowedUrl', () => {
  it('allows HTTPS anywhere', () => {
    expect(() => assertAllowedUrl('https://music.example.com/rest/ping.view')).not.toThrow();
  });

  it('allows plain HTTP on a private host', () => {
    expect(() => assertAllowedUrl('http://192.168.1.10:4533/rest/ping.view')).not.toThrow();
    expect(() => assertAllowedUrl('http://nas:4533/rest/ping.view')).not.toThrow();
  });

  it('refuses plain HTTP to a public host', () => {
    expect(() => assertAllowedUrl('http://music.example.com/rest/ping.view'))
      .toThrow(InsecureUrlError);
    expect(() => assertAllowedUrl('http://8.8.8.8/rest/ping.view'))
      .toThrow('Refusing plain HTTP to 8.8.8.8');
  });

  it('does not hide a malformed URL behind the transport policy', () => {
    // fetch/`new URL` reports the syntax; this module only judges transport.
    expect(() => assertAllowedUrl('not a url')).not.toThrow();
  });
});

describe('redactUrl', () => {
  it('drops query strings and fragments so tokens do not reach logs', () => {
    expect(redactUrl('https://music.example/rest/stream.view?u=ari&t=secret&s=salt'))
      .toBe('https://music.example/rest/stream.view');
    expect(redactUrl('https://music.example/Audio/1/stream?ApiKey=secret#x'))
      .toBe('https://music.example/Audio/1/stream');
  });

  it('keeps a useful fallback for a malformed URL', () => {
    expect(redactUrl('not a url?token=secret')).toBe('not a url');
  });
});
