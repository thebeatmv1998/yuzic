import {
  ApiAdapter,
  AlbumsApi,
  ArtistsApi,
  GenresApi,
  PlaylistsApi,
  RatingsApi,
  StarredApi,
  SimilarApi,
  TracksApi,
  AuthApi,
  LyricsApi,
  JukeboxState
} from "@/providers/contracts/ServerAdapter";
import { SongsApi } from "@/providers/contracts/SongsApi";
import { FAVORITES_ID } from "@/constants/favorites";
import { serverProvenance } from "@/domain/identity/Provenance";

import { Server } from "@/providers/contracts/Server";

import { createNavidromeClient } from "./client";
import { connect } from "./auth/connect";
import { ping } from "./auth/ping";
import { startScan } from "./auth/startScan";

import { getAlbum } from "./albums/getAlbum";
import { getAlbumList } from "./albums/getAlbumList";

import { getArtistWithBiography } from "./artists/getArtist";
import { getArtists } from "./artists/getArtists";

import { getPlaylists } from "./playlists/getPlaylists";
import { getPlaylist } from "./playlists/getPlaylist";
import { buildFavoritesPlaylist } from "@/providers/server/buildFavoritesPlaylist";
import { createPlaylist } from "./playlists/createPlaylist";
import { deletePlaylist } from "./playlists/deletePlaylist";
import { renamePlaylist } from "./playlists/renamePlaylist";
import { addSongToPlaylist } from "./playlists/addSongToPlaylist";
import { movePlaylistEntry, removePlaylistEntry } from "./playlists/updatePlaylistEntries";

import { getStarredItems } from "./starred/getStarredItems";
import { star } from "./starred/star";
import { unstar } from "./starred/unstar";
import { setRating } from "./ratings/setRating";

import { getGenres } from "./genres/getGenres";

import { getLyricsBySongId } from "./lyrics/getLyricsBySongId";
import { getSong } from "./songs/getSong";
import { scrobble, nowPlaying } from "./songs/scrobble";
import { getTracks } from "./tracks/getTracks";
import { getSimilarSongs } from "./similar/getSimilarSongs";
import { getSimilarArtists as getNavidromeSimilarArtists } from "./similar/getSimilarArtists";
import {
  getInternetRadioStations,
  createInternetRadioStation,
  updateInternetRadioStation,
  deleteInternetRadioStation,
} from "./radio/getInternetRadioStations";
import {
  getShares,
  createShare,
  deleteShare,
  updateShare,
} from "./shares/getShares";
import { getTopSongs } from "./artists/getTopSongs";
import {
  getBookmarks,
  createBookmark,
  deleteBookmark,
} from "./bookmarks/getBookmarks";
import { getPlayQueue, savePlayQueue } from "./queue/getPlayQueue";
import * as jukeboxApi from "./jukebox";
import { getRandomSongs } from "./discovery/random";
import { getNowPlaying } from "./discovery/nowPlaying";
import {
  getPodcasts,
  getNewestPodcasts,
  createPodcastChannel,
  deletePodcastChannel,
  deletePodcastEpisode,
  downloadPodcastEpisode,
  refreshPodcasts,
} from "./podcasts/getPodcasts";

import { search as searchNavidrome } from "./search/search";

/** The Subsonic wire shape, renamed to the contract's terms — `position` is
 *  seconds, and the adapter boundary is where that stops being implied. */
function toJukeboxState(status: jukeboxApi.JukeboxStatus): JukeboxState {
  return {
    currentIndex: status.currentIndex,
    playing: status.playing,
    gain: status.gain,
    positionSeconds: status.position,
  };
}

export const createNavidromeAdapter = (server: Server): ApiAdapter => {
  const { id: serverId, serverUrl, fallbackUrls, username, auth: providerAuth, basicAuth, customHeaders } = server;
  const password = providerAuth?.password as string;

  // Every domain entity requires provenance, and provenance for a server
  // record needs a real server id. `Server.id` is a required field of the
  // `Server` type, so this is always sound here — unlike `NavidromeClient`'s
  // own `serverId`, which is optional only because `NavidromeClientConfig`
  // doubles as the shape used before a server is saved (auth/connect), where
  // no id exists yet. Building provenance once here, rather
  // than reading `client.serverId` inside every endpoint, means those
  // pre-save code paths never have to fake one.
  const provenance = serverProvenance(serverId);

  // Support new array format (musicFolderIds) and old single-value format (musicFolderId)
  const musicFolderIds: string[] =
    Array.isArray(providerAuth?.musicFolderIds) ? (providerAuth.musicFolderIds as string[]) :
    providerAuth?.musicFolderId ? [String(providerAuth.musicFolderId)] :
    [];

  const client = createNavidromeClient({ serverUrl, serverId, fallbackUrls, username, password, basicAuth, customHeaders });

  const clientFor = (folderId: string) =>
    createNavidromeClient({ serverUrl, serverId, fallbackUrls, username, password, defaultParams: { musicFolderId: folderId }, basicAuth, customHeaders });

  // Domain entities have no top-level `id` to de-dupe on (that ambiguity is
  // exactly what `localId`/`nativeId` replaced), so callers say how to key
  // whatever shape `fn` returns — a bare entity by `nativeId`, an
  // entity+tracks pair by the entity's.
  async function fromFolders<T>(
    fn: (c: ReturnType<typeof createNavidromeClient>) => Promise<T[]>,
    keyOf: (item: T) => string
  ): Promise<T[]> {
    if (musicFolderIds.length === 0) return fn(client);
    if (musicFolderIds.length === 1) return fn(clientFor(musicFolderIds[0]));
    const all = (await Promise.all(musicFolderIds.map(id => fn(clientFor(id))))).flat();
    const seen = new Set<string>();
    return all.filter(item => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const auth: AuthApi = {
    connect: (serverUrl, username, password) =>
      connect(serverUrl, username, password),
    ping: () => ping(client),
    startScan: () => startScan(client),
    disconnect: () => {},
  };

  const albums: AlbumsApi = {
    list: async () => {
      const [baseAlbums, starred] = await Promise.all([
        fromFolders(c => getAlbumList(c, provenance), (a) => a.nativeId),
        getStarredItems(client, provenance),
      ]);
      const baseIds = new Set(baseAlbums.map((a) => a.nativeId));
      const seenStarredIds = new Set<string>();
      const albumIdsFromStarred: string[] = [];
      for (const s of starred.songs) {
        const albumId = s.album.nativeId;
        if (albumId && !seenStarredIds.has(albumId)) {
          seenStarredIds.add(albumId);
          if (!baseIds.has(albumId)) albumIdsFromStarred.push(albumId);
        }
      }
      const extraAlbums = await Promise.all(
        albumIdsFromStarred.map((id) => getAlbum(client, id, provenance))
      );
      const added = extraAlbums
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map((detail) => detail.album);
      return [...baseAlbums, ...added];
    },

    get: async (id: string) => {
      const full = await getAlbum(client, id, provenance);
      if (!full) throw new Error("Album not found");
      return full;
    },

  };

  const artists: ArtistsApi = {
    list: async () => fromFolders(c => getArtists(c, provenance), (a) => a.nativeId),
    get: async (id: string) => {
      const artist = await getArtistWithBiography(client, id, provenance);
      if (!artist) throw new Error("Artist not found");
      return artist;
    },
    getTopSongs: async (artistName, limit) => getTopSongs(client, provenance, artistName, limit),
  };

  const genres: GenresApi = {
    list: async () => getGenres(client),
  };

  const playlists: PlaylistsApi = {
    list: async () => {
      const [playlists, starred] = await Promise.all([
        getPlaylists(client, provenance),
        getStarredItems(client, provenance),
      ]);
      const favorites = buildFavoritesPlaylist(starred.songs, provenance);
      return [favorites, ...playlists];
    },

    get: async (id: string) => {
      if (id === FAVORITES_ID) {
        const starred = await getStarredItems(client, provenance);
        return { playlist: buildFavoritesPlaylist(starred.songs, provenance), songs: starred.songs };
      }
      const detail = await getPlaylist(client, id, provenance);
      if (!detail) throw new Error("Playlist not found");
      return detail;
    },

    create: async (name: string) => {
      const res = await createPlaylist(client, name);
      if (!res.id) throw new Error("Failed to create playlist");
      return res.id;
    },

    addSong: async (playlistId, songId) => {
      if (playlistId === FAVORITES_ID) {
        await star(client, songId);
        return;
      }
      await addSongToPlaylist(client, playlistId, songId);
    },

    removeSong: async (playlistId, songId, position) => {
      if (playlistId === FAVORITES_ID) {
        await unstar(client, songId);
        return;
      }
      await removePlaylistEntry(client, provenance, playlistId, songId, position);
    },

    moveSong: async (playlistId, move) => {
      if (playlistId === FAVORITES_ID) {
        throw new Error("Favorites has no order to change");
      }
      await movePlaylistEntry(client, provenance, playlistId, move);
    },

    rename: async (id: string, newName: string) => {
      if (id === FAVORITES_ID) {
        throw new Error("Cannot rename Favorites playlist");
      }
      await renamePlaylist(client, id, newName);
    },

    delete: async (id: string) => {
      if (id === FAVORITES_ID) {
        throw new Error("Cannot delete Favorites playlist");
      }
      await deletePlaylist(client, id);
    },
  };

  const starred: StarredApi = {
    list: async () => getStarredItems(client, provenance),
    add: async (id, type) => { await star(client, id, type); },
    remove: async (id, type) => { await unstar(client, id, type); },
  };

  const ratings: RatingsApi = {
    set: async (id, rating) => setRating(client, id, rating),
  };

  const songs: SongsApi = {
    get: async (id: string) => getSong(client, id, provenance),
    scrobble: async (songId, timestamp) => scrobble(client, songId, timestamp),
    reportNowPlaying: async (songId) => nowPlaying(client, songId),
    buildStreamUrl: (songId, quality, codec) => client.buildStreamUrl(songId, quality, codec),
    scrobbleKind: 'scrobble',
    transcodes: true,
    reportsLoudness: true,
    // Navidrome ships an Opus transcoding profile and downsamples to Opus by
    // default; it was being asked for MP3 regardless. Declared like any other
    // capability — the switch appears, off, and what the platform can decode
    // is a separate question answered at the stream URL.
    streamableCodecs: ['mp3', 'opus'],
  };

  const tracks: TracksApi = {
    list: async () => fromFolders(c => getTracks(c, provenance), (s) => s.nativeId),
    get: async (id: string) => getSong(client, id, provenance),
  };

  const similar: SimilarApi = {
    getSimilarSongs: async (songId: string) => getSimilarSongs(client, provenance, songId),
    getSimilarArtists: async (artistId, limit) => getNavidromeSimilarArtists(client, provenance, artistId, limit),
  };

  const lyrics: LyricsApi = {
    getBySongId: async (songId) => getLyricsBySongId(client, songId),
  };

  const search = {
    search: async (query: string) => searchNavidrome(client, provenance, query),
  };

  const radio = {
    list: async () => getInternetRadioStations(client),
    create: async (input: { name: string; streamUrl: string; homepageUrl?: string }) =>
      createInternetRadioStation(client, input),
    update: async (input: { id: string; name: string; streamUrl: string; homepageUrl?: string }) =>
      updateInternetRadioStation(client, input),
    remove: async (id: string) => deleteInternetRadioStation(client, id),
  };

  const shares = {
    list: async () => getShares(client),
    create: async (input: { itemId: string; description?: string; expiresAtMs?: number | null }) =>
      createShare(client, input),
    update: async (input: { id: string; description?: string; expiresAtMs?: number | null }) =>
      updateShare(client, input),
    remove: async (id: string) => deleteShare(client, id),
  };

  const bookmarks = {
    list: async () => getBookmarks(client),
    create: async (input: { songId: string; positionMs: number; comment?: string }) =>
      createBookmark(client, input),
    remove: async (songId: string) => deleteBookmark(client, songId),
  };

  const queue = {
    get: async () => getPlayQueue(client),
    save: async (input: { songIds: string[]; currentSongId?: string; positionMs?: number }) =>
      savePlayQueue(client, input),
  };

  const discovery = {
    getRandomSongs: async (opts?: { size?: number; genre?: string; fromYear?: number; toYear?: number }) =>
      getRandomSongs(client, provenance, opts),
    getNowPlaying: async () => getNowPlaying(client),
  };

  // Subsonic's jukebox is admin-granted per user: the endpoint exists on every
  // Navidrome, and answers error 50 for a user without the role. Presence here
  // therefore means "this server speaks jukebox", not "you may use it" — the
  // output picker probes status() before it offers the row.
  const jukebox = {
    status: async () => toJukeboxState(await jukeboxApi.getStatus(client)),
    setPlaylist: async (songIds: string[]) => toJukeboxState(await jukeboxApi.setPlaylist(client, songIds)),
    start: async () => toJukeboxState(await jukeboxApi.start(client)),
    stop: async () => toJukeboxState(await jukeboxApi.stop(client)),
    skip: async (index: number, offsetSeconds?: number) =>
      toJukeboxState(await jukeboxApi.skip(client, index, offsetSeconds)),
    clear: async () => toJukeboxState(await jukeboxApi.clear(client)),
    setGain: async (gain: number) => toJukeboxState(await jukeboxApi.setGain(client, gain)),
  };

  const podcasts = {
    list: async (includeEpisodes?: boolean) => getPodcasts(client, { includeEpisodes }),
    newestEpisodes: async (count?: number) => getNewestPodcasts(client, count),
    subscribe: async (rssUrl: string) => createPodcastChannel(client, rssUrl),
    unsubscribe: async (channelId: string) => deletePodcastChannel(client, channelId),
    deleteEpisode: async (episodeId: string) => deletePodcastEpisode(client, episodeId),
    downloadEpisode: async (episodeId: string) => downloadPodcastEpisode(client, episodeId),
    refreshAll: async () => refreshPodcasts(client),
  };

  const user = {
    // Navidrome always answers `getAvatar` with an image — a gravatar when the
    // account has one, its own generated fallback otherwise — so this is
    // offered unconditionally rather than probed. A server that 404s it lands
    // in the image loader's normal failure path and the caller falls back to
    // the initial disc, which is the same outcome as returning null here.
    avatarUrl: () => client.buildAvatarUrl(),
  };

  return {
    auth,
    albums,
    artists,
    genres,
    playlists,
    starred,
    ratings,
    songs,
    tracks,
    similar,
    lyrics,
    search,
    radio,
    shares,
    bookmarks,
    queue,
    discovery,
    podcasts,
    jukebox,
    user,
  };
};
