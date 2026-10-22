const mockServerFetch = jest.fn();

jest.mock('@/features/mtls/serverFetch', () => ({
  serverFetch: (...args: unknown[]) => mockServerFetch(...args),
}));

jest.mock('@/providers/server/installationId', () => ({
  getInstallationId: () => 'install-1',
}));

import { _resetCache } from '@/providers/http/urlFailover';
import { createPlexClient } from './client';

beforeEach(() => {
  _resetCache();
  mockServerFetch.mockReset();
});

describe('Plex client bodies', () => {
  it('resolves a write Plex answers with an empty body', async () => {
    mockServerFetch.mockResolvedValueOnce({ ok: true, text: async () => '' });
    const client = createPlexClient({ serverUrl: 'https://home.example', token: 't' });

    await expect(client.request('/:/rate?key=1&rating=10', { method: 'PUT' })).resolves.toEqual({});
  });

  it('still rejects a refused request, with its status', async () => {
    mockServerFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => '' });
    const client = createPlexClient({ serverUrl: 'https://home.example', token: 't' });

    await expect(client.request('/playlists')).rejects.toMatchObject({ status: 401, message: 'Plex request failed (401)' });
  });

  it('hands back a body that is not JSON as text', async () => {
    mockServerFetch.mockResolvedValueOnce({ ok: true, text: async () => '[00:01.00] Line' });
    const client = createPlexClient({ serverUrl: 'https://home.example', token: 't' });

    await expect(client.requestText('/library/streams/9')).resolves.toBe('[00:01.00] Line');
  });
});

describe('Plex client failover', () => {
  it('uses the reachable fallback for subsequent direct-play and image URLs', async () => {
    mockServerFetch
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ MediaContainer: {} }) });
    const client = createPlexClient({
      serverUrl: 'https://home.example',
      serverId: 'plex-1',
      fallbackUrls: ['https://tailnet.example'],
      token: 'plex-token',
    });

    await client.request('/library/sections');

    expect(mockServerFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://home.example/library/sections',
      'https://tailnet.example/library/sections',
    ]);
    expect(client.buildStreamUrl('/library/parts/1')).toContain('https://tailnet.example/library/parts/1');
    expect(client.buildImageUrl('/library/metadata/1/thumb')).toContain('https://tailnet.example/library/metadata/1/thumb');
  });
});

describe('Plex client custom header', () => {
  it('sends every configured header without displacing the Plex token', async () => {
    mockServerFetch.mockResolvedValueOnce({ ok: true, text: async () => '{}' });
    const client = createPlexClient({
      serverUrl: 'https://home.example',
      token: 'plex-token',
      customHeaders: [
        { name: 'X-Api-Key', value: 'proxy-secret' },
        { name: 'X-Authentik-Username', value: 'ari' },
      ],
    });

    await client.request('/library/sections');

    expect(mockServerFetch.mock.calls[0][1].headers).toMatchObject({
      'X-Api-Key': 'proxy-secret',
      'X-Authentik-Username': 'ari',
      'X-Plex-Token': 'plex-token',
    });
  });
});
