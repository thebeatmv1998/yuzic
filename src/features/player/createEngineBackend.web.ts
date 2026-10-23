import type { PlayerBackend, BackendEvent } from './backend';
import type { MediaItem } from './mediaItem';
import type { BrowseCategory } from './browse';
import type { CrossfadeSettings, EqualizerBand, LoudnessSettings } from './audioSettings';

/**
 * `PlayerBackend`, implemented on an `HTMLAudioElement` for the web build.
 *
 * The app talks to the player through `PlayerBackend` (see `backend.ts`), and
 * yuzic-engine implements it natively. That seam was kept deliberately — "a
 * second implementation is not hypothetical either — the engine does not run on
 * web" — so this file is that second implementation. It is picked instead of
 * `createEngineBackend.ts` on the `web` platform by Metro's platform-extension
 * resolution (`createEngineBackend.web.ts`).
 *
 * What works: queue, transport, seek, skip, volume, speed, repeat, the
 * synchronous progress/getters the UI polls, sleep timer, and the event stream
 * (`stateChange`, `trackChange`, `queueChange`, `error`).
 *
 * What does not, and why:
 * - **Crossfade, equalizer, loudness normalisation.** These are the engine's
 *   DSP. A plain `HTMLAudioElement` has none of it, and wiring a `WebAudio`
 *   graph would require the stream to be CORS-clean and would break playback
 *   outright when it is not. They are accepted and ignored, so choosing a
 *   setting changes nothing rather than silencing the player.
 * - **Request headers on the stream.** `MediaItem.headers` cannot be attached
 *   to an `<audio>` element, so a server behind Basic auth needs its URL to
 *   carry the credential instead.
 * - **The CarPlay browse tree and the engine's disk cache.** No-ops.
 */
function mediaUrl(item: MediaItem | undefined): string | null {
  if (!item) return null;
  return typeof item.url === 'string' ? item.url : item.url.uri;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type RepeatMode = 'off' | 'track' | 'queue';

export function createEngineBackend(): PlayerBackend {
  let queue: MediaItem[] = [];
  let activeIndex = 0;
  let listeners: ((event: BackendEvent) => void)[] = [];

  let isPlaying = false;
  let buffering = false;
  let repeatMode: RepeatMode = 'off';
  let volume = 1;
  let speed = 1;

  let outgoingProgress = { position: 0, duration: 0, buffered: 0 };
  let outgoingListenedSec: number | undefined;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let queueKnown = false;

  // Created lazily so importing this module outside a browser (a test, a build
  // step) does not throw. `getBackend()` is only called at runtime, in the page.
  let audio: HTMLAudioElement | null = null;

  function emit(event: BackendEvent) {
    for (const listener of listeners) listener(event);
  }

  function element(): HTMLAudioElement | null {
    if (audio) return audio;
    if (typeof Audio === 'undefined') return null;
    audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume;
    audio.playbackRate = speed;

    audio.addEventListener('loadedmetadata', () => {
      emit({ type: 'stateChange', buffering: false, playing: isPlaying });
    });
    audio.addEventListener('canplay', () => {
      buffering = false;
      emit({ type: 'stateChange', buffering: false, playing: isPlaying });
    });
    audio.addEventListener('playing', () => {
      isPlaying = true;
      buffering = false;
      emit({ type: 'stateChange', buffering: false, playing: true });
    });
    audio.addEventListener('pause', () => {
      isPlaying = false;
      emit({ type: 'stateChange', buffering: false, playing: false });
    });
    audio.addEventListener('waiting', () => {
      buffering = true;
      emit({ type: 'stateChange', buffering: true, playing: isPlaying });
    });
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', () => {
      const code = audio?.error?.code;
      emit({
        type: 'error',
        code: code ? `MEDIA_ERR_${code}` : 'MEDIA_ERROR',
        message: 'The audio source could not be played.',
      });
    });

    return audio;
  }

  function activeItem(): MediaItem | null {
    return queue[activeIndex] ?? null;
  }

  function load(index: number, autoplay: boolean) {
    activeIndex = index;
    buffering = true;
    emit({ type: 'stateChange', buffering: true, playing: false });
    emit({ type: 'trackChange', index });

    const el = element();
    if (!el) return;
    const item = activeItem();
    if (!item) {
      el.removeAttribute('src');
      el.load();
      return;
    }
    el.src = mediaUrl(item) ?? '';
    el.playbackRate = speed;
    el.volume = volume;
    if (autoplay) {
      void el.play().catch(error => {
        emit({ type: 'error', code: 'PLAYBACK_FAILED', message: String(error) });
      });
    }
  }

  function handleEnded() {
    const el = element();
    // Where the finished track got to, for the scrobble threshold and any
    // resume bookmark — read before the next track replaces it.
    outgoingProgress = {
      position: el ? el.currentTime : 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      buffered: 0,
    };
    outgoingListenedSec = outgoingProgress.duration || undefined;

    if (repeatMode === 'track') {
      if (el) {
        el.currentTime = 0;
        void el.play().catch(() => {});
      }
      return;
    }
    if (activeIndex + 1 < queue.length) {
      load(activeIndex + 1, true);
      return;
    }
    if (repeatMode === 'queue' && queue.length > 0) {
      load(0, true);
      return;
    }
    isPlaying = false;
    emit({ type: 'stateChange', buffering: false, playing: false });
  }

  function bufferedAhead(): number {
    const el = audio;
    if (!el || el.buffered.length === 0) return 0;
    const position = el.currentTime;
    for (let i = 0; i < el.buffered.length; i += 1) {
      if (el.buffered.start(i) <= position && position <= el.buffered.end(i)) {
        return el.buffered.end(i);
      }
    }
    return el.buffered.end(el.buffered.length - 1);
  }

  return {
    setup() {
      element();
      if (!queueKnown) {
        queueKnown = true;
        queueMicrotask(() => emit({ type: 'engineQueueKnown' }));
      }
    },

    setCommands() {
      // Media Session integration is optional and platform-specific; nothing to
      // register here.
    },

    setMediaItems(items, startIndex = 0) {
      const wasPlaying = isPlaying;
      queue = [...items];
      emit({ type: 'queueChange' });
      load(startIndex, wasPlaying);
    },

    addMediaItems(items) {
      queue = [...queue, ...items];
      emit({ type: 'queueChange' });
    },

    insertMediaItem(index, item) {
      const next = [...queue];
      next.splice(index, 0, item);
      if (index <= activeIndex) activeIndex += 1;
      queue = next;
      emit({ type: 'queueChange' });
    },

    removeMediaItem(index) {
      const next = [...queue];
      next.splice(index, 1);
      if (index < activeIndex) activeIndex -= 1;
      else if (index === activeIndex) {
        queue = next;
        emit({ type: 'queueChange' });
        if (next.length === 0) {
          element()?.pause();
        } else {
          load(Math.min(activeIndex, next.length - 1), isPlaying);
        }
        return;
      }
      queue = next;
      emit({ type: 'queueChange' });
    },

    moveMediaItem(from, to) {
      const next = [...queue];
      const [moved] = next.splice(from, 1);
      if (moved !== undefined) next.splice(to, 0, moved);
      if (from === activeIndex) activeIndex = to;
      else if (from < activeIndex && to >= activeIndex) activeIndex -= 1;
      else if (from > activeIndex && to <= activeIndex) activeIndex += 1;
      queue = next;
      emit({ type: 'queueChange' });
    },

    clear() {
      queue = [];
      activeIndex = 0;
      const el = element();
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      isPlaying = false;
      emit({ type: 'queueChange' });
      emit({ type: 'stateChange', buffering: false, playing: false });
    },

    play() {
      const el = element();
      if (!el || !activeItem()) return;
      buffering = true;
      emit({ type: 'stateChange', buffering: true, playing: false });
      void el.play().catch(error => {
        emit({ type: 'error', code: 'PLAYBACK_FAILED', message: String(error) });
      });
    },

    pause() {
      element()?.pause();
    },

    stop() {
      const el = element();
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
      isPlaying = false;
      emit({ type: 'stateChange', buffering: false, playing: false });
    },

    seekTo(positionSeconds) {
      const el = element();
      if (!el) return;
      try {
        el.currentTime = positionSeconds;
      } catch {
        // Seeking before metadata is ready throws; the next load lands it.
      }
    },

    skipToNext() {
      if (activeIndex + 1 < queue.length) load(activeIndex + 1, true);
      else if (repeatMode === 'queue' && queue.length > 0) load(0, true);
      else this.stop();
    },

    skipToIndex(index) {
      if (index < 0 || index >= queue.length) return;
      load(index, true);
    },

    setVolume(next) {
      volume = clamp(next, 0, 1);
      const el = element();
      if (el) el.volume = volume;
    },

    setPlaybackSpeed(next) {
      speed = next;
      const el = element();
      if (el) el.playbackRate = next;
    },

    setRepeatMode(mode) {
      repeatMode = mode;
    },

    setCrossfade(_options: CrossfadeSettings | null) {
      // No DSP on a plain audio element; see the file header.
    },

    setEqualizer(_bands: EqualizerBand[]) {
      // No DSP on a plain audio element; see the file header.
    },

    setLoudness(_options: LoudnessSettings) {
      // No DSP on a plain audio element; see the file header.
    },

    getProgress() {
      const el = audio;
      const item = activeItem();
      const duration =
        el && Number.isFinite(el.duration) && el.duration > 0
          ? el.duration
          : item?.duration ?? 0;
      return {
        position: el ? el.currentTime : 0,
        duration,
        buffered: bufferedAhead(),
      };
    },

    getOutgoingProgress() {
      return outgoingProgress;
    },

    getOutgoingListenedSec() {
      return outgoingListenedSec;
    },

    getQueue() {
      return queue;
    },

    getActiveMediaItemIndex() {
      return queue.length > 0 ? activeIndex : null;
    },

    getActiveMediaItem() {
      return activeItem();
    },

    sleepAfterTime(seconds, options = {}) {
      if (sleepTimer) clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        // A fade would need the DSP; the timer simply stops playback.
        void options;
        element()?.pause();
      }, Math.max(0, seconds) * 1000);
    },

    cancelSleepTimer() {
      if (sleepTimer) clearTimeout(sleepTimer);
      sleepTimer = null;
    },

    clearCache() {
      // The browser owns the media cache.
    },

    evict(_mediaId: string) {
      // The browser owns the media cache.
    },

    setBrowseTree(_categories: BrowseCategory[]) {
      // CarPlay/Android Auto browse trees do not exist on the web.
    },

    clearBrowseTree() {
      // CarPlay/Android Auto browse trees do not exist on the web.
    },

    engineQueueKnown() {
      return queueKnown;
    },

    addListener(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter(other => other !== listener);
      };
    },
  };
}
