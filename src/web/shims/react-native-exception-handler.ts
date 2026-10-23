/**
 * Web shim for `react-native-exception-handler`.
 *
 * Global JS/native exception hooks are a React Native facility. The browser has
 * `window.onerror` instead, and the app only uses the hooks to show a restart
 * alert, so these are no-ops here.
 */
type JSExceptionHandler = (error: unknown, isFatal: boolean) => void;

let currentHandler: JSExceptionHandler = () => {};

export function setJSExceptionHandler(handler: JSExceptionHandler, _allowInDev?: boolean): void {
  currentHandler = handler;
}

export function getJSExceptionHandler(): JSExceptionHandler {
  return currentHandler;
}

export function setNativeExceptionHandler(
  _handler?: (message: string, isFatal: boolean, error: unknown) => void,
  _forceQuit?: boolean,
  _quitAfter?: boolean,
): void {}

export default {
  setJSExceptionHandler,
  getJSExceptionHandler,
  setNativeExceptionHandler,
};
