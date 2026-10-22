import type {
  ApiAdapter,
  AlbumsApi,
  ArtistsApi,
  AuthApi,
  DiscoveryApi,
  GenresApi,
  LyricsApi,
  LyricsResult,
  PlaylistsApi,
  SearchApi,
  SimilarApi,
  StarredApi,
  TracksApi,
} from '@/providers/contracts/ServerAdapter';
import type { SongsApi } from '@/providers/contracts/SongsApi';
import type { Server } from '@/providers/contracts/Server';
import type { Song } from '@/domain/entities/Song';
import type { AlbumDetail, PlaylistDetail } from '@/domain/entities/Detail';
import { makeLocalId } from '@/domain/identity/LocalId';
import { serverProvenance } from '@/domain/identity/Provenance';
import type { PlexMetadata, PlexResponse } from './types';
import { createPlexClient } from './client';
import { mapSong } from './mapSong';
import { mapAlbum } from './mapAlbum';
import { mapArtist } from './mapArtist';
import { mapPlaylist } from './mapPlaylist';
import { createPlexPlaybackReporter } from './playbackReporting';
import { ratePath } from './urlCommands';
import { entryIndex, movedOrder } from '@/providers/server/playlistEntries';
import { parseLrc } from '@/providers/integration/lrclib/parseLrc';
import { PlexRequestError } from './requestError';
import { metadata, pagedMetadata } from './pagedMetadata';

const FAVORITE_RATING = 10;
/** Plex's stream type for lyrics, beside 1 video, 2 audio and 3 subtitles. */
const LYRICS_STREAM_TYPE = 4;
const SIMILAR_LIMIT = 50;
/** How far, in sonic distance, a track may be and still count as similar — Plex's own default. */
const SIMILAR_MAX_DISTANCE = 0.25;

/** LRC when the text carries timestamps; otherwise plain lines to read along with. */
function lyricsFromText(text: string): LyricsResult | null {
  const synced = parseLrc(text);
  if (synced.length > 0) return { synced: true, lines: synced };
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => ({ startMs: 0, text: line }));
  return lines.length > 0 ? { synced: false, lines } : null;
}

function sectionIds(server: Server): string[] {
  const current = server.auth?.sectionIds;
  if (Array.isArray(current)) return current.map(String);
  const legacy = server.auth?.sectionId;
  return legacy ? [String(legacy)] : [];
}

/** Plex is a distinct protocol, deliberately not a MediaBrowser brand. */
export function createPlexAdapter(server: Server): ApiAdapter {
  const token = server.auth?.token as string | undefined;
  const client = createPlexClient({
    serverUrl: server.serverUrl,
    serverId: server.id,
    fallbackUrls: server.fallbackUrls,
    token,
    basicAuth: server.basicAuth,
    customHeaders: server.customHeaders,
  });
  const sections = sectionIds(server);
  // Built once at the client boundary and threaded into every mapper call —
  // every entity this adapter produces comes from this one server.
  const provenance = serverProvenance(server.id);

  async function sectionKeys(): Promise<string[]> {
    return sections.length ? sections : (await client.request<PlexResponse>('/library/sections')).MediaContainer?.Directory?.map(s => String(s.key)).filter(Boolean) ?? [];
  }

  /**
   * Everything of one type across the library's sections, mapped as it
   * arrives and deduped by the caller's key.
   *
   * A record can sit in two sections, so the same rating key can come back
   * twice. The dedupe is on the mapped value rather than the DTO, which is
   * what lets a page's DTOs go before the next request. Sections are still
   * fetched together and kept in section order, so the list a caller sees is
   * the one it saw before.
   */
  async function libraryItems<T>(
    type: number,
    map: (dto: PlexMetadata) => T | null,
    keyOf: (value: T) => string,
    extra = ''
  ): Promise<T[]> {
    const ids = await sectionKeys();
    const sectionResults = await Promise.all(ids.map(section =>
      pagedMetadata(client, `/library/sections/${encodeURIComponent(section)}/all?type=${type}${extra}`, map)
    ));

    const seen = new Set<string>();
    const all: T[] = [];
    for (const results of sectionResults) {
      for (const value of results) {
        const key = keyOf(value);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push(value);
      }
    }
    return all;
  }

  /** How the rows above are told apart, per shape. */
  const ratingKeyOf = (dto: PlexMetadata): string => String(dto.ratingKey ?? '');
  const byNativeId = (entity: { nativeId: string }): string => entity.nativeId;
  const asTrack = (dto: PlexMetadata): Song | null =>
    dto.type === 'track' ? mapSong(dto, { provenance }) : null;

  async function item(id: string): Promise<PlexMetadata | null> {
    const result = await client.request<PlexResponse>(`/library/metadata/${encodeURIComponent(id)}`);
    return metadata(result)[0] ?? null;
  }

  async function itemTracks(id: string): Promise<PlexMetadata[]> {
    return pagedMetadata(client, `/library/metadata/${encodeURIComponent(id)}/children`, dto => dto);
  }

  let machineIdentifier: Promise<string> | null = null;

  /**
   * The root every Plex item URI hangs off — `server://<machine id>/…`.
   * Playlist writes name items by URI rather than by rating key alone.
   * Asked once; a failed ask is forgotten so the next write asks again.
   */
  function libraryUri(): Promise<string> {
    machineIdentifier ??= client.request<PlexResponse>('/identity').then(response => {
      const id = response.MediaContainer?.machineIdentifier;
      if (!id) throw new Error('Plex did not say which server it is');
      return id;
    });
    machineIdentifier.catch(() => { machineIdentifier = null; });
    return machineIdentifier.then(id => `server://${id}/com.plexapp.plugins.library`);
  }

  /** A playlist's track entries in order — the same ones `playlists.get` shows, so positions agree. */
  async function playlistEntries(playlistId: string): Promise<PlexMetadata[]> {
    const entries = await pagedMetadata(client, `/playlists/${encodeURIComponent(playlistId)}/items`, dto => dto);
    return entries.filter(entry => entry.type === 'track');
  }

  function mapTracks(items: PlexMetadata[]): Song[] {
    return items.filter(track => track.type === 'track').map(track => mapSong(track, { provenance }));
  }

  async function albumDetail(dto: PlexMetadata, trackItems: PlexMetadata[]): Promise<AlbumDetail> {
    const songs = mapTracks(trackItems);
    const album = mapAlbum(dto, { provenance, songIds: songs.map(song => song.localId) });
    return { album, songs };
  }

  const auth: AuthApi = {
    connect: async () => ({ success: false, message: 'Plex uses code sign-in.' }),
    ping: async () => {
      if (!token) return false;
      // /identity is intentionally public; a protected endpoint is required to
      // distinguish an invalid/expired account token from a reachable server.
      try { await client.request('/library/sections'); return true; } catch { return false; }
    },
    startScan: async () => ({ success: false, message: 'Plex scans are managed on the server.' }),
    disconnect: () => {},
  };

  const albums: AlbumsApi = {
    list: async () => libraryItems(9, dto => mapAlbum(dto, { provenance }), byNativeId),
    get: async (id) => {
      const [album, trackItems] = await Promise.all([item(id), itemTracks(id)]);
      if (!album) throw new Error('Album not found');
      return albumDetail(album, trackItems);
    },
  };

  const artists: ArtistsApi = {
    list: async () => libraryItems(8, dto => mapArtist(dto, provenance), byNativeId),
    get: async (id) => {
      const artist = await item(id);
      if (!artist) throw new Error('Artist not found');
      // An artist's children under Plex are its albums, not its tracks.
      const albumIds = (await itemTracks(id))
        .filter(entry => entry.type === 'album')
        .map(entry => makeLocalId('album', provenance, String(entry.ratingKey ?? '')));
      return { ...mapArtist(artist, provenance), albumIds };
    },
  };

  const genres: GenresApi = {
    // Plex's collection-level genre endpoint varies by server/scanner. Album
    // Genre tags are present on the live server, so derive the stable union
    // from those rather than relying on an unverified endpoint.
    // Read off the DTO, not the mapped album: `mapAlbum` splits a `Rock;Jazz`
    // tag into two genres, which is arguably right and is not this change's
    // to make.
    list: async () => [...new Set((await libraryItems(9, dto => dto, ratingKeyOf)).flatMap(album => album.Genre?.map(g => g.tag ?? '') ?? []).filter(Boolean))].sort(),
  };

  const tracks: TracksApi = {
    list: async () => libraryItems(10, asTrack, byNativeId),
    get: async (id) => {
      const track = await item(id);
      return track?.type === 'track' ? mapSong(track, { provenance }) : null;
    },
  };

  // A Plex song id is its rating key, which is what both playback endpoints
  // address the track by. What each of them needs beyond that, and why they
  // need it, lives in `playbackReporting`.
  const playback = createPlexPlaybackReporter(client);

  const songs: SongsApi = {
    get: tracks.get,
    buildStreamUrl: (partKey) => client.buildStreamUrl(partKey),
    // Plex receives explicit playback/scrobble events; it is not a
    // MediaBrowser "mark played" endpoint.
    scrobbleKind: 'scrobble',
    transcodes: false,
    reportsLoudness: false,
    streamableCodecs: [],
    scrobble: (songId) => playback.scrobble(songId),
    reportNowPlaying: (songId) => playback.nowPlaying(songId),
    reportPlaybackProgress: (songId, positionMs, paused) => playback.progress(songId, positionMs, paused),
    reportPlaybackStop: (songId, positionMs) => playback.stop(songId, positionMs),
  };

  const starred: StarredApi = {
    list: async () => {
      const songs = await libraryItems(10, asTrack, byNativeId, `&userRating=${FAVORITE_RATING}`);
      const albums = await libraryItems(
        9, dto => mapAlbum(dto, { provenance }), byNativeId, `&userRating=${FAVORITE_RATING}`
      );
      return { songs, albums };
    },
    add: async (id) => { await client.request(ratePath(id, FAVORITE_RATING), { method: 'PUT' }); },
    remove: async (id) => { await client.request(ratePath(id, 0), { method: 'PUT' }); },
  };

  const playlists: PlaylistsApi = {
    list: async () => pagedMetadata(client, '/playlists?playlistType=audio', dto => mapPlaylist(dto, { provenance })),
    get: async (id): Promise<PlaylistDetail> => {
      const base = metadata(await client.request<PlexResponse>(`/playlists/${encodeURIComponent(id)}`))[0];
      if (!base) throw new Error('Playlist not found');
      const entries = await pagedMetadata(client, `/playlists/${encodeURIComponent(id)}/items`, dto => dto);
      const songs = mapTracks(entries);
      const playlist = mapPlaylist(base, { provenance, songIds: songs.map(song => song.localId) });
      return { playlist, songs };
    },
    create: async (name) => {
      const created = metadata(await client.request<PlexResponse>(
        `/playlists?type=audio&smart=0&title=${encodeURIComponent(name)}&uri=${encodeURIComponent(await libraryUri())}`,
        { method: 'POST' },
      ))[0];
      if (created?.ratingKey == null) throw new Error('Plex did not create the playlist');
      return String(created.ratingKey);
    },
    rename: async (id, newName) => {
      await client.request(`/playlists/${encodeURIComponent(id)}?title=${encodeURIComponent(newName)}`, { method: 'PUT' });
    },
    addSong: async (playlistId, songId) => {
      await client.request(
        `/playlists/${encodeURIComponent(playlistId)}/items?uri=${encodeURIComponent(`${await libraryUri()}/library/metadata/${songId}`)}`,
        { method: 'PUT' },
      );
    },
    removeSong: async (playlistId, songId, position) => {
      const entries = await playlistEntries(playlistId);
      const entry = entries[entryIndex(entries.map(e => String(e.ratingKey)), songId, position)];
      await client.request(
        `/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(String(entry.playlistItemID))}`,
        { method: 'DELETE' },
      );
    },
    moveSong: async (playlistId, move) => {
      const entries = await playlistEntries(playlistId);
      const from = entryIndex(entries.map(e => String(e.ratingKey)), move.songId, move.from);
      const reordered = movedOrder(entries, from, move.to);
      const to = reordered.indexOf(entries[from]);
      if (to === from) return;
      // Plex places an entry after another; with none named it goes first.
      const after = to > 0 ? `?after=${encodeURIComponent(String(reordered[to - 1].playlistItemID))}` : '';
      await client.request(
        `/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(String(entries[from].playlistItemID))}/move${after}`,
        { method: 'PUT' },
      );
    },
    delete: async (id) => {
      await client.request(`/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };

  const similar: SimilarApi = {
    // Sonically similar tracks. Plex has them only for libraries it has run
    // sonic analysis on; elsewhere the endpoint is absent, which is "none"
    // rather than a failure. Any other error still rejects.
    getSimilarSongs: async (songId) => {
      try {
        const response = await client.request<PlexResponse>(
          `/library/metadata/${encodeURIComponent(songId)}/nearest?limit=${SIMILAR_LIMIT}&maxDistance=${SIMILAR_MAX_DISTANCE}`
        );
        return mapTracks(metadata(response)).filter(song => song.nativeId !== songId);
      } catch (error) {
        if (error instanceof PlexRequestError && error.status === 404) return [];
        throw error;
      }
    },
  };

  const lyrics: LyricsApi = {
    // Lyrics are a stream on the track's media part — a sidecar file or
    // Plex's own lyrics — fetched as text from the stream's key.
    getBySongId: async (songId) => {
      const track = await item(songId);
      const stream = (track?.Media ?? [])
        .flatMap(media => media.Part ?? [])
        .flatMap(part => part.Stream ?? [])
        .find(candidate => candidate.streamType === LYRICS_STREAM_TYPE && candidate.key);
      if (!stream?.key) return null;
      return lyricsFromText(await client.requestText(stream.key));
    },
  };
  const search: SearchApi = {
    search: async (query) => {
      if (!query.trim()) return { albums: [], artists: [], songs: [] };
      const response = await client.request<PlexResponse>(`/hubs/search?query=${encodeURIComponent(query)}`);
      const results = response.MediaContainer?.Hub?.flatMap(hub => hub.Metadata ?? []) ?? metadata(response);
      return {
        albums: results.filter(result => result.type === 'album').map(dto => mapAlbum(dto, { provenance })),
        artists: results.filter(result => result.type === 'artist').map(dto => mapArtist(dto, provenance)),
        songs: mapTracks(results),
      };
    },
  };

  const discovery: DiscoveryApi = {
    getRandomSongs: async (opts = {}) => {
      const size = opts.size ?? 50;
      // Plex filters by genre id, not name, and tracks often carry no genre
      // of their own. Draw a wider page and keep the tracks tagged with it;
      // too few, and the shelf falls back to an untinted draw by itself.
      const pageSize = opts.genre ? size * 4 : size;
      const ids = await sectionKeys();
      const pages = await Promise.all(ids.map(section => client.request<PlexResponse>(
        `/library/sections/${encodeURIComponent(section)}/all?type=10&sort=random`,
        { headers: { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(pageSize) } },
      )));
      const draws = pages.map(page => mapTracks(metadata(page)));
      const merged: Song[] = [];
      for (let i = 0; draws.some(draw => i < draw.length); i++) {
        for (const draw of draws) if (draw[i]) merged.push(draw[i]);
      }
      const genre = opts.genre?.toLowerCase();
      const inYears = (song: Song) =>
        (!opts.fromYear || (song.year ?? 0) >= opts.fromYear) && (!opts.toYear || (song.year ?? Infinity) <= opts.toYear);
      return merged
        .filter(song => !genre || song.genres.some(tag => tag.toLowerCase() === genre))
        .filter(inYears)
        .slice(0, size);
    },
    getNowPlaying: async () => {
      // Only the server's owner may read every session; for a managed or
      // shared user Plex refuses, and there is nothing to show rather than
      // something broken.
      let response: PlexResponse;
      try {
        response = await client.request<PlexResponse>('/status/sessions');
      } catch {
        return [];
      }
      return metadata(response)
        .filter(entry => entry.type === 'track' && entry.ratingKey != null)
        .map(entry => {
          const song = mapSong(entry, { provenance });
          return {
            songId: song.nativeId,
            title: song.title,
            artist: song.artist.name,
            albumTitle: song.album.title || undefined,
            albumId: song.album.nativeId || undefined,
            cover: song.cover,
            username: entry.User?.title ?? '',
            minutesAgo: 0,
          };
        });
    },
  };

  return { auth, albums, artists, genres, playlists, starred, songs, tracks, similar, lyrics, search, discovery };
}
