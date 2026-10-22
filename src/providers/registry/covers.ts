/**
 * How each kind of cover becomes an image URL and a cache key — the outside
 * archives' URL shapes and each server's key layout — declared with the
 * providers, so image code asks for "the cover" and never names who serves it.
 */
import { COVER_PX, CoverSource } from '@/domain/entities/Cover';
import store from '@/state/redux/store';
import { selectActiveServer } from '@/state/redux/selectors/serversSelectors';
import { SERVER_PROVIDERS } from './serverConnections';
import { withServerCredentials } from './serverCredentials';
import { customHeadersForRequest } from '@/providers/http/customHeader';
import { normalizeImageUrlForSize } from '@/features/artwork/normalizeImageUrl';
import { resolveCoverNow } from '@/features/artwork/coverResolution';

function buildCoverArtArchiveUrl(
  mbid: string,
  mbidType: 'release' | 'release-group',
  size: 'thumb' | 'grid' | 'detail' | 'background'
): string | null {
  if (!mbid) return null

  // CAA only guarantees 250 and 500 thumbnails for release-group covers.
  // 1200 is only generated for large originals and 404s otherwise.
  const mbSize = COVER_PX[size] <= 250 ? 250 : 500
  const endpoint = mbidType === 'release' ? 'release' : 'release-group'

  return `https://coverartarchive.org/${endpoint}/${mbid}/front-${mbSize}`
}

/**
 * What a cover is *of*, as one stable string, with no size in it.
 *
 * For the drawn stand-in behind art that does not exist: it needs the same
 * answer for a thumb and a detail tile, or one album would be two colours on
 * two screens. Here rather than at the call site because knowing which
 * providers exist is this layer's job — a component branching on
 * `navidrome`/`jellyfin`/`emby` is what `check-provider-branches` is for.
 *
 * Null when the cover names nothing to be stable about, which leaves the caller
 * to seed from the subject instead.
 */
export function coverIdentity(source: CoverSource): string | null {
  const cover = source ? resolveCoverNow(source).cover : source;
  if (!cover || cover.kind === 'none' || cover.kind === 'special') return null;

  if (cover.kind === 'url') return `url:${cover.url}`;
  if (cover.kind === 'coverartarchive') return `coverartarchive:${cover.mbid}:${cover.mbidType}`;
  if (cover.kind === 'navidrome') return `navidrome:${cover.coverArtId}`;
  if (cover.kind === 'jellyfin') return `jellyfin:${cover.itemId}`;
  if (cover.kind === 'emby') return `emby:${cover.itemId}`;
  if (cover.kind === 'plex') return `plex:${cover.path}`;

  return null;
}

export function buildCoverCacheKey(
  source: CoverSource,
  size: 'thumb' | 'grid' | 'detail' | 'background'
): string | null {
  const px = COVER_PX[size];
  // A gap is filled from the library or a remembered backup before anything
  // is built, so every surface that asks for a URL gets the same picture.
  const cover = source ? resolveCoverNow(source).cover : source;

  if (!cover || cover.kind === 'none' || cover.kind === 'special') return null;

  if (cover.kind === 'url') return `url:${cover.url}:${px}`;
  if (cover.kind === 'coverartarchive') return `coverartarchive:${cover.mbid}:${cover.mbidType}:${px}`;

  const state = store.getState();
  const active = selectActiveServer(state);
  if (!active) return null;

  if (cover.kind === 'navidrome') return `navidrome:${active.id}:${cover.coverArtId}:${px}`;
  if (cover.kind === 'jellyfin') return `jellyfin:${active.id}:${cover.itemId}:${px}`;
  if (cover.kind === 'emby') return `emby:${active.id}:${cover.itemId}:${cover.tag ?? ''}:${px}`;

  return null;
}

/**
 * Headers an on-screen cover request needs, or undefined when it needs none.
 *
 * The image loader is a separate transport from the API clients: it takes a
 * URL and, on some components, headers. A server behind something that
 * authenticates every request therefore needs the same custom header here as
 * its API calls, or a library whose metadata loads would still draw blank
 * tiles. Only a server-owned cover gets them — a Cover Art Archive URL and a
 * user-supplied URL are somebody else's host and must never receive a secret
 * meant for the user's server.
 *
 * The value comes from the keystore through `withServerCredentials`; the
 * Redux `Server` this reads carries only the header name.
 */
export function buildCoverRequestHeaders(
  source: CoverSource
): Record<string, string> | undefined {
  const cover = source ? resolveCoverNow(source).cover : source;
  if (!cover) return undefined;
  const serverOwned =
    cover.kind === 'navidrome' ||
    cover.kind === 'jellyfin' ||
    cover.kind === 'emby' ||
    cover.kind === 'plex';
  if (!serverOwned) return undefined;

  const active = selectActiveServer(store.getState());
  if (!active) return undefined;
  const live = withServerCredentials(active);
  const headers: Record<string, string> = {
    ...customHeadersForRequest(live.customHeaders),
    ...(SERVER_PROVIDERS[active.type]?.mediaAuthHeaders?.(live) ?? {}),
  };
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * The covers the app draws rather than fetches, as the sentinels `buildCover`
 * returns for them. Not URLs — see `isDrawnCover`.
 */
export const DRAWN_COVER = {
  heart: 'heart-icon',
  radio: 'radio-icon',
} as const;

/**
 * Whether what `buildCover` returned is a drawn cover rather than a URL.
 *
 * Every surface that fetches the value instead of rendering it has to ask:
 * handed to the engine it becomes a now-playing artwork URI that resolves to
 * nothing, which is a blank cover on the lock screen and in the car.
 */
export function isDrawnCover(uri: string | null | undefined): boolean {
  return uri === DRAWN_COVER.heart || uri === DRAWN_COVER.radio;
}

export function buildCover(
  source: CoverSource,
  size: 'thumb' | 'grid' | 'detail' | 'background'
): string | null {
  const px = COVER_PX[size];
  const cover = source ? resolveCoverNow(source).cover : source;

  if (!cover || cover.kind === 'none') {
    // A station nobody had a logo for. The missing-artwork glyph is the sign
    // for *broken*, which a stream playing perfectly well is not — so this
    // gap draws the radio mark instead of the torn-picture one.
    return cover?.kind === 'none' && cover.subject?.kind === 'station'
      ? DRAWN_COVER.radio
      : null;
  }

  // Artwork the app draws rather than fetches. These are sentinels, not URLs:
  // `MediaImage` recognises them and renders a component. Anything that hands
  // this value to something expecting a real URL — the engine's now-playing
  // artwork, notably — has to check `isDrawnCover` first.
  if (cover.kind === 'special' && cover.name === 'heart') {
    return DRAWN_COVER.heart;
  }

  if (cover.kind === 'url') {
    return cover.url ? normalizeImageUrlForSize(cover.url, px) : null;
  }

  if (cover.kind === 'coverartarchive') {
    return buildCoverArtArchiveUrl(cover.mbid, cover.mbidType, size)
  }

  const state = store.getState();
  const active = selectActiveServer(state);

  if (!active) return null;

  const provider = SERVER_PROVIDERS[active.type];
  if (!provider) return null;
  return provider.buildCoverUrl(withServerCredentials(active), cover, px);
}
