export type ServerType = "navidrome" | "jellyfin" | "emby" | "plex" | "local";

export type ProviderAuth = {
  [key: string]: string | number | boolean | null | string[];
};


/**
 * `password` is optional because this same shape does double duty: the
 * persisted `Server.basicAuth` (Redux/MMKV) never carries it — a reverse-proxy
 * password is a secret and lives in the keystore, keyed by server id (see
 * `src/state/credentials.ts`) — while a *composed* server, built for one live
 * call by `withServerCredentials` in `src/providers/registry/serverConnections.ts`, fills it
 * in from there. A provider client that needs to send the header receives the
 * composed form and can rely on the field being present at that point.
 */
export interface BasicAuth {
  username: string;
  password?: string;
}

/**
 * One extra header sent with every request to this server.
 *
 * `value` is a secret — a proxy's API key, an access token, a shared secret —
 * so the persisted `Server` carries only `name`. The value lives in the
 * keystore under `customHeaderValue` and is merged back for one live call by
 * `withServerCredentials`, exactly like `BasicAuth.password`.
 */
export interface CustomHeader {
  name: string;
  /** Present only on a composed server; see above. */
  value?: string;
}

export interface Server {
  id: string;
  type: ServerType;
  /** Primary URL, always present. First entry probed on fresh sessions. */
  serverUrl: string;
  /**
   * Optional fallback URLs, tried in order when the primary fails —
   * e.g. a LAN address plus a Tailscale/domain that only works off-network
   * (issue #115). `serverUrl` itself is not repeated here.
   */
  fallbackUrls?: string[];
  username: string;
  /**
   * Non-secret provider fields only — library scope ids, `userId`, and the
   * like. `password` and `token` are never written here: they live in the
   * keystore (`src/state/credentials.ts`), keyed by this server's id, and are
   * merged back in only for the duration of one live call by
   * `withServerCredentials` (`src/providers/registry/serverConnections.ts`). Redux is
   * persisted to MMKV as plain JSON, so a secret placed here would be a secret
   * disclosed.
   */
  auth?: ProviderAuth;
  basicAuth?: BasicAuth;
  /**
   * Non-secret half of an optional custom request header. Sent on every
   * request to this server, including stream and artwork fetches.
   */
  customHeader?: CustomHeader;
  isAuthenticated: boolean;
}