import { useCallback, useEffect, useRef, useState } from 'react';

import type { CodeAuthApi } from '@/providers/registry/serverProviderTypes';
import type { BasicAuth, CustomHeader, ProviderAuth } from '@/providers/contracts/Server';
import { codeAuthServerFailure } from '@/providers/registry/codeAuthServerError';

type CodeAuthPhase =
  /** Not started — the password form is showing. */
  | { status: 'idle' }
  /** `begin()` is in flight; there is no code to show yet. */
  | { status: 'starting' }
  /** Showing `code` and polling for approval. */
  | { status: 'waiting'; code: string }
  /** The user approved; these are the credentials to save. */
  | { status: 'approved'; auth: ProviderAuth; username: string }
  /**
   * Gave up. `reason` separates the ways this ends: the code went stale unused,
   * the flow never started, or the user approved and the server then either
   * refused the account (`serverRefused`) or could not be reached
   * (`serverUnreachable`). The last two are not code problems and must not be
   * described as one — and they need opposite advice from each other.
   */
  | {
      status: 'failed';
      reason: 'expired' | 'error' | 'serverRefused' | 'serverUnreachable';
      message?: string;
    };

type Options = {
  codeAuth: CodeAuthApi | undefined;
  serverUrl: string;
  basicAuth?: BasicAuth;
  customHeaders?: CustomHeader[];
};

/**
 * Drives a code-based sign-in: begin, poll until approved, expire on time.
 *
 * Extracted from the onboarding screen rather than left inline because the
 * interesting part is a state machine with a timer in it, and the house style
 * is to pull that kind of decision out where it can be tested. The screen is
 * then only responsible for rendering whichever phase it is handed.
 *
 * Two details are easy to get wrong and are handled here:
 *
 * - **A poll that throws is not a failure.** The network drops, a proxy
 *   hiccups, the server restarts mid-flow. Each poll is independently
 *   attempted and a thrown one is swallowed, because the next one two seconds
 *   later is likely to succeed and the code has not expired yet. Only the
 *   timeout ends a waiting flow.
 * - **The interval must not outlive the screen.** Polling holds the server URL
 *   and proxy credentials, and an interval that survives unmount keeps hitting
 *   a server for a flow nobody is watching.
 */
export function useCodeAuth({ codeAuth, serverUrl, basicAuth, customHeaders }: Options) {
  const [phase, setPhase] = useState<CodeAuthPhase>({ status: 'idle' });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  // The poll closure reads these, and re-creating the interval whenever a
  // proxy field changes would restart the flow under the user.
  const basicAuthRef = useRef(basicAuth);
  basicAuthRef.current = basicAuth;
  const customHeadersRef = useRef(customHeaders);
  customHeadersRef.current = customHeaders;

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const cancel = useCallback(() => {
    stopPolling();
    setPhase({ status: 'idle' });
  }, [stopPolling]);

  const start = useCallback(async () => {
    if (!codeAuth || !serverUrl) return;

    stopPolling();
    setPhase({ status: 'starting' });

    let handle: unknown;
    try {
      const begun = await codeAuth.begin({
        serverUrl,
        basicAuth: basicAuthRef.current,
        customHeaders: customHeadersRef.current,
      });
      handle = begun.handle;
      setPhase({ status: 'waiting', code: begun.code });
    } catch (err: any) {
      setPhase({ status: 'failed', reason: 'error', message: err?.message });
      return;
    }

    startedAtRef.current = Date.now();

    intervalRef.current = setInterval(async () => {
      if (Date.now() - startedAtRef.current > codeAuth.timeoutMs) {
        stopPolling();
        setPhase({ status: 'failed', reason: 'expired' });
        return;
      }

      let result: Awaited<ReturnType<CodeAuthApi['poll']>>;
      try {
        result = await codeAuth.poll({
          serverUrl,
          handle,
          basicAuth: basicAuthRef.current,
          customHeaders: customHeadersRef.current,
        });
      } catch (err) {
        // Approval already happened and the server is what said no, so waiting
        // cannot help: every retry re-fails, and the timeout would end this by
        // blaming a code the user has already used successfully.
        const serverFailure = codeAuthServerFailure(err);
        if (serverFailure) {
          stopPolling();
          setPhase({
            status: 'failed',
            reason: serverFailure === 'refused' ? 'serverRefused' : 'serverUnreachable',
            message: err instanceof Error ? err.message : undefined,
          });
          return;
        }
        // Transient — the code is still good, so keep waiting for the timeout
        // to be the thing that ends this rather than one unlucky request.
        return;
      }

      if (!result) return;

      stopPolling();
      setPhase({ status: 'approved', auth: result.auth, username: result.username });
    }, codeAuth.pollIntervalMs);
  }, [codeAuth, serverUrl, stopPolling]);

  return { phase, start, cancel };
}
