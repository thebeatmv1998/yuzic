/**
 * Web shim for `react-native-restart`.
 *
 * The real module tears the JS bundle down and relaunches it. The browser
 * equivalent is a page reload.
 */
const RNRestart = {
  Restart: (): void => {
    if (typeof location !== 'undefined') location.reload();
  },
};

export default RNRestart;
export { RNRestart };
