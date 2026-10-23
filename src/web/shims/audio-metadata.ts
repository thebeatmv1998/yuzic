/**
 * Web shim for `@missingcore/audio-metadata`.
 *
 * The real module reads ID3/FLAC/MP4 tags off a file on disk. Local-file import
 * is a native feature — the browser has no arbitrary filesystem to copy into a
 * private library — so nothing on the web path calls this with a real file.
 * It answers with no tags rather than throwing.
 */
export type AudioMetadataTags = Record<string, unknown>;

export async function getAudioMetadata(
  _fileUri: string,
  _tags?: readonly string[],
): Promise<AudioMetadataTags> {
  return {};
}

export default { getAudioMetadata };
