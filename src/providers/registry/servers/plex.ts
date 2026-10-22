import PlexIcon from '@assets/images/plex.png';

import { createPlexClient, plexBasicAuthHeader } from '@/providers/server/plex/client';
import { createPlexAdapter } from '@/providers/server/plex';
import { beginPlexPin, pollPlexPin } from '@/providers/server/plex/auth/pin';
import { probeAddress as probePlexAddress } from '@/providers/server/plex/auth/probeAddress';
import type { ServerProviderConfig } from '@/providers/registry/serverProviderTypes';
import i18n from '@/i18n';

export const plexProvider: ServerProviderConfig = {
  type: 'plex',
  label: 'Plex',
  get description() { return i18n.t('onboarding.connect.providerDescription.plex'); },
  icon: { kind: 'image', source: PlexIcon },
  capabilities: { supportsDemo: false },
  libraryScope: { key: 'sectionIds', legacyKey: 'sectionId' },
  listLibraries: async (server) => {
    const token = server.auth?.token as string | undefined;
    const client = createPlexClient({
      serverUrl: server.serverUrl,
      serverId: server.id,
      fallbackUrls: server.fallbackUrls,
      token,
      basicAuth: server.basicAuth,
      customHeader: server.customHeader,
    });
    const response = await client.request<any>('/library/sections');
    return (response.MediaContainer?.Directory ?? [])
      .filter((section: any) => section.type === 'artist')
      .map((section: any) => ({ id: String(section.key), name: section.title ?? 'Music' }));
  },
  addressHintKey: 'onboarding.address.hintPlex',
  probeAddress: (url) => probePlexAddress(url),
  ping: async (url, _username, auth, basicAuth, customHeader) => {
    const token = auth.token as string | undefined;
    if (!token) return false;
    try {
      // /identity is public; a protected section endpoint verifies both the
      // Plex account token and any configured proxy credentials.
      await createPlexClient({ serverUrl: url, token, basicAuth, customHeader }).request('/library/sections');
      return true;
    } catch { return false; }
  },
  // Plex’s account token comes from PIN authorization. Keeping password auth
  // explicitly unavailable is safer than silently sending a password to an
  // endpoint Plex does not use.
  connect: async () => ({ success: false, message: i18n.t('onboarding.credentials.codeAuth.plex.useCode') }),
  createAdapter: (server) => createPlexAdapter(server),
  codeAuth: {
    begin: async ({ serverUrl, basicAuth }) => beginPlexPin(serverUrl, basicAuth),
    poll: async ({ serverUrl, handle, basicAuth, customHeader }) =>
      pollPlexPin(String(handle), serverUrl, basicAuth, customHeader),
    pollIntervalMs: 2000,
    timeoutMs: 10 * 60 * 1000,
    instructionKey: 'onboarding.credentials.codeAuth.plex.instruction',
    actionKey: 'onboarding.credentials.codeAuth.plex.action',
  },
  // A Plex server behind a reverse proxy with Basic auth needs it on every
  // stream and artwork request.
  mediaAuthHeaders: (server) => plexBasicAuthHeader(server.basicAuth) ?? null,
  buildCoverUrl: (server, cover) => {
    if (cover.kind !== 'plex' || !server.serverUrl) return null;
    const token = server.auth?.token as string | undefined;
    return createPlexClient({
      serverUrl: server.serverUrl,
      serverId: server.id,
      fallbackUrls: server.fallbackUrls,
      token,
      basicAuth: server.basicAuth,
      customHeader: server.customHeader,
    }).buildImageUrl(cover.path);
  },
};
