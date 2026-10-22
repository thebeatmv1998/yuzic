import NavidromeIcon from '@assets/images/navidrome.png';

import { createNavidromeClient, buildTokenParams } from '@/providers/server/navidrome/client';
import { ping as pingNavidrome } from '@/providers/server/navidrome/auth/ping';
import { connect as connectNavidrome } from '@/providers/server/navidrome/auth/connect';
import { getMusicFolders } from '@/providers/server/navidrome/auth/getMusicFolders';
import { probeAddress as probeSubsonicAddress } from '@/providers/server/navidrome/auth/probeAddress';
import { createNavidromeAdapter } from '@/providers/server/navidrome';
import type { ServerProviderConfig } from '@/providers/registry/serverProviderTypes';
import i18n from '@/i18n';

// Cache token params per credential key so cover URLs are stable across renders
// (expo-image caches by URL — a new random salt on every render = cache miss every time)
const coverTokenCache = new Map<string, { u: string; t: string; s: string }>();

function getCoverTokenParams(username: string, password: string) {
  const key = `${username}:${password}`;
  if (!coverTokenCache.has(key)) {
    coverTokenCache.set(key, buildTokenParams(username, password));
  }
  return coverTokenCache.get(key)!;
}

export const navidromeProvider: ServerProviderConfig = {
  type: 'navidrome',
  label: 'Navidrome',
  get description() { return i18n.t('onboarding.connect.providerDescription.navidrome'); },
  icon: { kind: 'image', source: NavidromeIcon },
  capabilities: {
    supportsDemo: true,
  },
  libraryScope: { key: 'musicFolderIds', legacyKey: 'musicFolderId' },
  listLibraries: (server) => getMusicFolders(server),
  addressHintKey: 'onboarding.address.hintNavidrome',
  probeAddress: (url) => probeSubsonicAddress(url),
  ping: async (url, username, auth, basicAuth, customHeader) => {
    const password = auth.password as string;
    if (!username || !password) return false;
    const client = createNavidromeClient({ serverUrl: url, username, password, basicAuth, customHeader });
    return pingNavidrome(client);
  },
  connect: async (url, username, password, basicAuth, customHeader) => {
    const result = await connectNavidrome(url, username, password, basicAuth, customHeader);
    if (!result.success) {
      return {
        success: false,
        message: result.message,
      };
    }
    return {
      success: true,
      username,
      auth: {
        password
      },
      libraries: result.libraries ?? [],
    };
  },
  createAdapter: (server) => createNavidromeAdapter(server),
  buildCoverUrl: (server, cover, px) => {
    if (cover.kind !== 'navidrome') return null;
    const password = server.auth?.password as string | undefined;
    if (!server.serverUrl || !server.username || !password) return null;
    const { u, t, s } = getCoverTokenParams(server.username, password);
    const params = new URLSearchParams({ id: cover.coverArtId, size: String(px), u, t, s, v: '1.16.0', c: 'Yuzic' });
    return `${server.serverUrl}/rest/getCoverArt.view?${params}`;
  },
  demo: async () => {
    const serverUrl = 'https://demo.navidrome.org';
    const username = 'demo';
    const password = 'demo';
    const result = await connectNavidrome(serverUrl, username, password);
    if (!result.success) {
      throw new Error(result.message || i18n.t('onboarding.connect.demoFailed'));
    }
    return {
      serverUrl,
      username,
      auth: {
        password,
        ...(result.libraries?.[0]?.id
          ? { musicFolderId: result.libraries[0].id }
          : {}),
      },
    };
  },
};
