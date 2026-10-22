import type { Server } from '@/providers/contracts/Server';
import { serverProvenance } from '@/domain/identity/Provenance';
import { _clearCredentialCache, setCredential } from '@/state/credentialCache';
import { mediaHeadersForSong } from './mediaHeaders';

// btoa may be absent in the jest environment; the Plex client's header builder
// uses global.btoa exactly as the app does at runtime.
if (typeof global.btoa !== 'function') {
  global.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}

/**
 * What the player is handed: a song plus the URL for this attempt. Only the
 * song's provenance and the URL matter here, so the rest is minimal.
 */
const resource = (over: { serverId?: string; streamUrl?: string } = {}) => ({
  song: { provenance: serverProvenance(over.serverId ?? 'srv-1') },
  streamUrl: over.streamUrl ?? 'https://plex.example/library/parts/1/file.mp3?X-Plex-Token=t',
});

const server = (over: Partial<Server> = {}): Server => ({
  id: 'srv-1',
  type: 'plex',
  serverUrl: 'https://plex.example',
  username: 'zack',
  isAuthenticated: true,
  ...over,
});

const expectedAuth = `Basic ${global.btoa('proxy-user:proxy-password')}`;

describe('mediaHeadersForSong', () => {
  afterEach(() => _clearCredentialCache());

  it('attaches the Basic auth header to both audio and artwork for a Basic-auth Plex server', () => {
    const result = mediaHeadersForSong(
      server({ basicAuth: { username: 'proxy-user', password: 'proxy-password' } }),
      resource()
    );
    expect(result.headers).toEqual({ Authorization: expectedAuth });
    expect(result.artworkHeaders).toEqual({ Authorization: expectedAuth });
  });

  it('yields no headers for a token-only Plex server (no Basic auth)', () => {
    const result = mediaHeadersForSong(server({ basicAuth: undefined }), resource());
    expect(result.headers).toBeUndefined();
    expect(result.artworkHeaders).toBeUndefined();
  });

  it('yields no headers for a Navidrome server even with Basic auth set', () => {
    // Navidrome signs its URLs; a Basic-auth field here would be a proxy for a
    // different provider and must not leak onto Plex-style header auth.
    const result = mediaHeadersForSong(
      server({ type: 'navidrome', basicAuth: { username: 'u', password: 'p' } }),
      resource()
    );
    expect(result.headers).toBeUndefined();
    expect(result.artworkHeaders).toBeUndefined();
  });

  it('yields no headers when there is no active server', () => {
    expect(mediaHeadersForSong(null, resource())).toEqual({});
    expect(mediaHeadersForSong(undefined, resource())).toEqual({});
  });

  it('skips a locally-downloaded track even on a Basic-auth Plex server', () => {
    // A file:// path is already on disk and needs no server credentials.
    const result = mediaHeadersForSong(
      server({ basicAuth: { username: 'proxy-user', password: 'proxy-password' } }),
      resource({ streamUrl: 'file:///downloads/audio/song-1.mp3' })
    );
    expect(result).toEqual({});
  });

  it('serves a track that came from the active server', () => {
    const result = mediaHeadersForSong(
      server({ id: 'srv-1', basicAuth: { username: 'proxy-user', password: 'proxy-password' } }),
      resource({ serverId: 'srv-1' })
    );
    expect(result.headers).toEqual({ Authorization: expectedAuth });
    expect(result.artworkHeaders).toEqual({ Authorization: expectedAuth });
  });

  it('attaches every configured custom header to audio and artwork for any provider', async () => {
    await setCredential(
      { kind: 'server', serverId: 'srv-1' },
      'customHeaders',
      JSON.stringify([
        { name: 'X-Api-Key', value: 'proxy-secret' },
        { name: 'X-Authentik-Username', value: 'ari' },
      ])
    );

    const result = mediaHeadersForSong(
      server({
        type: 'navidrome',
        customHeaders: [{ name: 'X-Api-Key' }, { name: 'X-Authentik-Username' }],
      }),
      resource()
    );

    expect(result.headers).toEqual({
      'X-Api-Key': 'proxy-secret',
      'X-Authentik-Username': 'ari',
    });
    expect(result.artworkHeaders).toEqual(result.headers);
  });

  it('sends both custom headers and Plex proxy Basic auth', async () => {
    await setCredential(
      { kind: 'server', serverId: 'srv-1' },
      'customHeaders',
      JSON.stringify([
        { name: 'X-Api-Key', value: 'proxy-secret' },
        { name: 'X-Authentik-Username', value: 'ari' },
      ])
    );

    const result = mediaHeadersForSong(
      server({
        basicAuth: { username: 'proxy-user', password: 'proxy-password' },
        customHeaders: [{ name: 'X-Api-Key' }, { name: 'X-Authentik-Username' }],
      }),
      resource()
    );

    expect(result.headers).toEqual({
      'X-Api-Key': 'proxy-secret',
      'X-Authentik-Username': 'ari',
      Authorization: expectedAuth,
    });
    expect(result.artworkHeaders).toEqual(result.headers);
  });

  it('does not send the active server custom headers to another server in a mixed queue', async () => {
    await setCredential(
      { kind: 'server', serverId: 'srv-1' },
      'customHeaders',
      JSON.stringify([{ name: 'X-Api-Key', value: 'proxy-secret' }])
    );

    const result = mediaHeadersForSong(
      server({ customHeaders: [{ name: 'X-Api-Key' }] }),
      resource({ serverId: 'srv-2' })
    );

    expect(result).toEqual({});
  });

  it('skips a track in a mixed queue that came from a different server', () => {
    // Matching on the origin's *id* rather than its type is what makes this
    // exact: two Plex servers share a type, and these credentials belong to
    // only one of them. Sending them to the other would leak them.
    const result = mediaHeadersForSong(
      server({ id: 'srv-1', type: 'plex', basicAuth: { username: 'proxy-user', password: 'proxy-password' } }),
      resource({ serverId: 'srv-2' })
    );
    expect(result).toEqual({});
  });
});
