/**
 * Web shim for `react-native-turbo-image`.
 *
 * The real component is a native image view with its own disk cache. On the
 * web it is `react-native-web`'s `Image`, which uses the browser's HTTP cache,
 * and the cache-management statics become no-ops.
 *
 * The `CachePolicy` statics are re-exported so call sites that read them keep
 * type-checking.
 */
import React from 'react';
import { Image } from 'react-native';

type TurboImageSource = { uri: string; cacheKey?: string };

type TurboImageProps = {
  source: TurboImageSource;
  style?: unknown;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
  onSuccess?: (event: unknown) => void;
  onFailure?: (event: unknown) => void;
  onLoad?: (event: unknown) => void;
  onError?: (event: unknown) => void;
  fadeDuration?: number;
  cachePolicy?: string;
  [key: string]: unknown;
};

function TurboImage({ source, style, resizeMode, onSuccess, onFailure, onError, ...rest }: TurboImageProps) {
  return (
    <Image
      {...rest}
      source={{ uri: source?.uri }}
      style={style as never}
      resizeMode={resizeMode}
      onLoad={onSuccess}
      onError={onFailure ?? onError}
    />
  );
}

TurboImage.prefetch = async (_sources: unknown, _policy?: string): Promise<void> => {};
TurboImage.clearDiskCache = async (): Promise<void> => {};
TurboImage.clearMemoryCache = async (): Promise<void> => {};
TurboImage.clearCache = async (): Promise<void> => {};
TurboImage.getCachePath = async (): Promise<string | null> => null;

export const CachePolicy = {
  dataCache: 'dataCache',
  memory: 'memory',
  memoryDisk: 'memoryDisk',
  disk: 'disk',
  diskNoCache: 'diskNoCache',
  none: 'none',
} as const;

export default TurboImage;
