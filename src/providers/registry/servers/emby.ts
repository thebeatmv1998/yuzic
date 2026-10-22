import EmbyIcon from '@assets/images/emby.png';

import { createEmbyClient } from '@/providers/server/media-browser/emby/client';
import { createEmbyAdapter } from '@/providers/server/media-browser/emby';
import { getMusicLibraries } from '@/providers/server/media-browser/auth/getMusicLibraries';
import { ping as pingMediaBrowser } from '@/providers/server/media-browser/auth/ping';
import { connect as connectMediaBrowser } from '@/providers/server/media-browser/auth/connect';
import { EMBY_BRAND } from '@/providers/server/media-browser/brand';
import { probeAddress as probeMediaBrowserAddress } from '@/providers/server/media-browser/auth/probeAddress';
import type { ServerProviderConfig } from '@/providers/registry/serverProviderTypes';
import i18n from '@/i18n';

export const embyProvider: ServerProviderConfig = {
  type: 'emby',
  label: 'Emby',
  get description() { return i18n.t('onboarding.connect.providerDescription.emby'); },
  icon: { kind: 'image', source: EmbyIcon },
  capabilities: {
    supportsDemo: false,
  },
  libraryScope: { key: 'parentIds', legacyKey: 'parentId' },
  listLibraries: (server) => getMusicLibraries(server),
  addressHintKey: 'onboarding.address.hintEmby',
  probeAddress: (url) => probeMediaBrowserAddress(EMBY_BRAND, url),
  ping: async (url, username, auth, basicAuth, customHeader) => {
    const token = auth.token as string;
    const userId = auth.userId as string;
    if (!token || !userId) return false;
    const client = createEmbyClient({ serverUrl: url, token, userId, basicAuth, customHeader });
    return pingMediaBrowser(client);
  },
  connect: async (url, username, password, basicAuth, customHeader) => {
    const result = await connectMediaBrowser(EMBY_BRAND, url, username, password, basicAuth, customHeader);
    if (!result.success) {
      return {
        success: false,
        message: result.message,
      };
    }
    return {
      success: true,
      auth: {
        password,
        token: result.token,
        userId: result.userId,
      },
    };
  },
  createAdapter: (server) => createEmbyAdapter(server),
  buildCoverUrl: (server, cover, px) => {
    if (cover.kind !== 'emby') return null;
    const token = server.auth?.token as string | undefined;
    if (!server.serverUrl || !token) return null;
    const baseUrl = server.serverUrl.replace(/\/$/, '');
    const paramObj: Record<string, string> = { quality: '90', maxWidth: String(px), maxHeight: String(px), api_key: token };
    if (cover.tag) paramObj.tag = cover.tag;
    const params = new URLSearchParams(paramObj);
    return `${baseUrl}/Items/${cover.itemId}/Images/Primary?${params}`;
  },
};
