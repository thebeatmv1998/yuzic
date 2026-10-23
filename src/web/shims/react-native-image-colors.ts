/**
 * Web shim for `react-native-image-colors`.
 *
 * The real module decodes cover art natively and returns a palette. On the web
 * the cover is usually cross-origin (the music server), so reading its pixels
 * would taint the canvas and throw. Rather than gamble on CORS, this returns a
 * flat palette built from the caller's `fallback` colour — the app treats a
 * single-colour palette correctly (`pickAccent` scores the candidates and takes
 * the most vivid), so cover tinting still works, it just stays neutral instead
 * of following the artwork.
 *
 * A `getColors` call is never allowed to reject: every call site relies on a
 * resolved palette to fall back from.
 */
type ExtractedColors = {
  platform: string;
  dominant?: string;
  average?: string;
  vibrant?: string;
  darkVibrant?: string;
  lightVibrant?: string;
  muted?: string;
  darkMuted?: string;
  lightMuted?: string;
  background?: string;
  primary?: string;
  secondary?: string;
  detail?: string;
};

type GetColorsConfig = {
  fallback?: string;
  [key: string]: unknown;
};

async function getColors(_uri: string, config: GetColorsConfig = {}): Promise<ExtractedColors> {
  const fallback = config.fallback ?? '#000000';
  return {
    platform: 'android',
    dominant: fallback,
    average: fallback,
    vibrant: fallback,
    darkVibrant: fallback,
    lightVibrant: fallback,
    muted: fallback,
    darkMuted: fallback,
    lightMuted: fallback,
  };
}

export default { getColors };
export { getColors };
