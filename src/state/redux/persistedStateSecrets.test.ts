/**
 * No secret reaches Redux (and therefore MMKV, which is what
 * redux-persist writes every persisted slice to as plain JSON).
 *
 * This seeds a store through the real credential-capture paths — the same
 * `saveServerCredentials` the onboarding screen calls on a successful
 * connect, and the same `setCredential` calls the ListenBrainz/AudioMuse/
 * downloader settings screens make from a field's `onChangeText` — with
 * distinctive sentinel values standing in for a password, a token, a
 * reverse-proxy Basic-auth password, and each integration's own secret.
 *
 * It then serializes the *entire* persisted state exactly as redux-persist
 * would write it to MMKV, and asserts none of the sentinels appear anywhere
 * in that text. Deliberately not a source-text inspection (grepping for
 * `.password` or `.token` in the slice files) — this reads the actual
 * serialized values a device's storage would hold, so it stays true if a new
 * field is added to any slice later without this file being touched.
 */
import { configureStore } from '@reduxjs/toolkit';
import { _rootReducer } from './store';
import { addServer, setActiveServer } from './slices/serversSlice';
import { setUsername } from './slices/listenbrainzSlice';
import { setAudiomuseServerUrl, connectAudiomuse } from './slices/audiomuseSlice';
import { setDownloaderServerUrl, connectDownloader } from './slices/downloadersSlice';
import { saveServerCredentials } from '@/providers/registry/serverCredentials';
import { listenBrainzCredentialScope } from './selectors/listenbrainzSelectors';
import { audiomuseCredentialScope } from './selectors/audiomuseSelectors';
import { downloaderCredentialScope } from './selectors/downloadersSelectors';
import { setCredential, _clearCredentialCache } from '@/state/credentialCache';

const SENTINEL_PASSWORD = 'SENTINEL-PASSWORD-1';
const SENTINEL_TOKEN = 'SENTINEL-TOKEN-1';
const SENTINEL_PROXY_PASSWORD = 'SENTINEL-PROXY-PASSWORD-1';
const SENTINEL_CUSTOM_HEADER_VALUE = 'SENTINEL-CUSTOM-HEADER-VALUE-1';
const SENTINEL_LISTENBRAINZ_TOKEN = 'SENTINEL-LISTENBRAINZ-TOKEN-1';
const SENTINEL_AUDIOMUSE_TOKEN = 'SENTINEL-AUDIOMUSE-TOKEN-1';
const SENTINEL_LIDARR_KEY = 'SENTINEL-LIDARR-KEY-1';
const SENTINEL_SLSKD_KEY = 'SENTINEL-SLSKD-KEY-1';

const ALL_SENTINELS = [
  SENTINEL_PASSWORD,
  SENTINEL_TOKEN,
  SENTINEL_PROXY_PASSWORD,
  SENTINEL_CUSTOM_HEADER_VALUE,
  SENTINEL_LISTENBRAINZ_TOKEN,
  SENTINEL_AUDIOMUSE_TOKEN,
  SENTINEL_LIDARR_KEY,
  SENTINEL_SLSKD_KEY,
];

const SERVER_ID = 'srv-sentinel-1';

function makeStore() {
  // `_rootReducer` — not the persisted wrapper `store` exports as default —
  // so this asserts over exactly the fields each slice contributes, the same
  // shape `persistReducer` hands to MMKV underneath its own bookkeeping keys.
  return configureStore({
    reducer: _rootReducer,
    middleware: getDefault => getDefault({ serializableCheck: false }),
  });
}

describe('no secret reaches persisted Redux state', () => {
  afterEach(() => {
    _clearCredentialCache();
  });

  it('keeps every sentinel secret out of the serialized store', async () => {
    const store = makeStore();

    // Server auth: the same shape `saveServer` in the onboarding credentials
    // screen builds from a successful `provider.connect()` — a secret
    // `password`/`token` plus a non-secret `userId`, and a reverse-proxy
    // Basic-auth password captured alongside it.
    const sanitized = await saveServerCredentials(
      SERVER_ID,
      { password: SENTINEL_PASSWORD, token: SENTINEL_TOKEN, userId: 'user-1' },
      { username: 'proxy-user', password: SENTINEL_PROXY_PASSWORD },
      { name: 'X-Yuzic-Test', value: SENTINEL_CUSTOM_HEADER_VALUE }
    );
    store.dispatch(addServer({
      id: SERVER_ID,
      type: 'navidrome',
      serverUrl: 'https://media.example',
      username: 'ari',
      auth: sanitized.auth,
      basicAuth: sanitized.basicAuth,
      customHeader: sanitized.customHeader,
      isAuthenticated: true,
    }));
    store.dispatch(setActiveServer(SERVER_ID));

    // ListenBrainz: username through Redux, token through `setCredential` —
    // exactly what the settings screen's two fields do.
    store.dispatch(setUsername({ serverId: SERVER_ID, value: 'lb-user' }));
    await setCredential(listenBrainzCredentialScope(SERVER_ID), 'token', SENTINEL_LISTENBRAINZ_TOKEN);

    // AudioMuse: serverUrl through Redux, API token through `setCredential`.
    store.dispatch(setAudiomuseServerUrl({ serverId: SERVER_ID, value: 'https://audiomuse.example' }));
    await setCredential(audiomuseCredentialScope(SERVER_ID), 'apiKey', SENTINEL_AUDIOMUSE_TOKEN);
    store.dispatch(connectAudiomuse({ serverId: SERVER_ID }));

    // Downloaders: one of each shape (lidarr + slskd), serverUrl through
    // Redux, apiKey through `setCredential`.
    store.dispatch(setDownloaderServerUrl({ serverId: SERVER_ID, downloader: 'lidarr', value: 'https://lidarr.example' }));
    await setCredential(downloaderCredentialScope('lidarr', SERVER_ID), 'apiKey', SENTINEL_LIDARR_KEY);
    store.dispatch(connectDownloader({ serverId: SERVER_ID, downloader: 'lidarr' }));

    store.dispatch(setDownloaderServerUrl({ serverId: SERVER_ID, downloader: 'slskd', value: 'https://slskd.example' }));
    await setCredential(downloaderCredentialScope('slskd', SERVER_ID), 'apiKey', SENTINEL_SLSKD_KEY);
    store.dispatch(connectDownloader({ serverId: SERVER_ID, downloader: 'slskd' }));

    const serialized = JSON.stringify(store.getState());

    for (const sentinel of ALL_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }

    // Sanity check: prove the assertions above aren't vacuous by confirming
    // the *non-secret* companions of each sentinel really did make it into
    // the serialized state — a passing "does not contain" test over a store
    // that captured nothing would prove nothing.
    expect(serialized).toContain('media.example');
    expect(serialized).toContain('proxy-user');
    // The header *name* is not a secret and has to survive so the settings
    // card can show what is configured; only the value must never appear.
    expect(serialized).toContain('X-Yuzic-Test');
    expect(serialized).toContain('user-1');
    expect(serialized).toContain('lb-user');
    expect(serialized).toContain('audiomuse.example');
    expect(serialized).toContain('lidarr.example');
    expect(serialized).toContain('slskd.example');
  });
});
