// Metro configuration for the self-hosted web build.
//
// yuzic is a React Native app. Most of it runs unchanged on the web through
// `react-native-web`, but a handful of dependencies are native-only (they call
// into `requireNativeComponent`, native audio, the keystore, UDP, and so on).
// Bundling them for `web` either fails outright or crashes the app at first
// render.
//
// So on the `web` platform only, those packages are resolved to small shims
// under `src/web/shims/`. Nothing here changes the iOS or Android bundles — the
// remap is gated on `platform === 'web'`.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Packages with no browser build, mapped to the shim that stands in for them.
const WEB_SHIMS = {
  'yuzic-engine': 'src/web/shims/yuzic-engine.ts',
  'expo-secure-store': 'src/web/shims/expo-secure-store.ts',
  'react-native-mmkv': 'src/web/shims/react-native-mmkv.ts',
  'react-native-turbo-image': 'src/web/shims/react-native-turbo-image.tsx',
  'react-native-image-colors': 'src/web/shims/react-native-image-colors.ts',
  'react-native-udp': 'src/web/shims/react-native-udp.ts',
  '@missingcore/audio-metadata': 'src/web/shims/audio-metadata.ts',
  'react-native-restart': 'src/web/shims/react-native-restart.ts',
  'react-native-exception-handler': 'src/web/shims/react-native-exception-handler.ts',
  '@react-native-community/slider': 'src/web/shims/slider.tsx',
  'react-native-reorderable-list': 'src/web/shims/reorderable-list.tsx',
};

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && Object.prototype.hasOwnProperty.call(WEB_SHIMS, moduleName)) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, WEB_SHIMS[moduleName]),
    };
  }
  return upstreamResolveRequest
    ? upstreamResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
