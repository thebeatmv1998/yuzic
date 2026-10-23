import PlayingBarBase from './PlayingBarBase';

/**
 * The now-playing bar on the web.
 *
 * It was an empty file, which is why the first web build crashed: a module with
 * no exports comes through Metro's interop as an object, and `<PlayingBar />`
 * then failed with "Element type is invalid ... got: object".
 *
 * `PlayingBarBase` is the shared implementation both native platforms render,
 * built on gesture-handler, reanimated and the sheet primitives — all of which
 * have web builds — so web can render the real bar rather than nothing.
 */
export default function PlayingBar() {
  return <PlayingBarBase />;
}
