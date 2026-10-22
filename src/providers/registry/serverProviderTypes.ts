import type { ComponentType } from 'react';

import type { CoverSource } from '@/domain/entities/Cover';
import type { BasicAuth, CustomHeader, ProviderAuth, Server, ServerType } from '@/providers/contracts/Server';
import type { ApiAdapter, Library } from '@/providers/contracts/ServerAdapter';
import type { AddressProbe } from '@/providers/server/addressProbe';

/** What a music server type declares about itself: see `serverConnections.ts`. */

type ConnectResult = {
  success: boolean;
  message?: string;
  auth?: ProviderAuth;
  libraries?: Library[];
};

type DemoResult = {
  serverUrl: string;
  username: string;
  auth?: ProviderAuth;
};

type ServerCapabilities = {
  supportsDemo: boolean;
};

/**
 * Where a provider keeps the user's chosen library ids inside `server.auth`.
 *
 * Subsonic scopes a request by `musicFolderId`, MediaBrowser by `parentId`, and
 * both were once written as a single id before multi-select existed — so each
 * provider names the array key it writes now and the singular key an upgrading
 * install may still be carrying. Callers read and write the selection through
 * `selectedLibraryIds` / `libraryScopePatch` rather than knowing either name.
 */
type LibraryScope = {
  key: string;
  legacyKey: string;
};

/**
 * Signing in by showing the user a code instead of asking for a password.
 *
 * Jellyfin calls it Quick Connect and Plex calls it a PIN, but the shape is
 * the same on both: begin the attempt and get back a code to display, poll
 * until the user approves it elsewhere, and receive the credentials. The
 * differences that remain — where the user types the code, how long it lives,
 * what the poll returns — are data the provider supplies rather than branches
 * the screen takes.
 *
 * This exists because the onboarding screen used to import Jellyfin's Quick
 * Connect directly and gate it on `type === 'jellyfin'`. That is the
 * provider-name branching the adapter layer bans, sitting one layer up where
 * the rule had never been applied, and adding a second provider with the same
 * flow would have meant a second branch beside it.
 *
 * A provider that has no such flow leaves `codeAuth` undefined and the option
 * does not render — the same presence-gating every optional capability uses.
 */
export type CodeAuthApi = {
  /**
   * Start an attempt. Returns the code to show the user plus an opaque handle
   * the poll takes back.
   *
   * `handle` is deliberately opaque: Jellyfin's is a secret string, Plex's is
   * a pin id paired with its code, and the screen should be able to hold
   * either without knowing which it has.
   */
  begin(input: {
    serverUrl: string;
    basicAuth?: BasicAuth;
    customHeader?: CustomHeader;
  }): Promise<{
    code: string;
    handle: unknown;
  }>;
  /**
   * One poll. Resolves to the finished auth once the user has approved, or
   * null while still waiting.
   *
   * Returning null rather than throwing matters: "not yet" is the expected
   * answer for most of this call's life, and a screen that had to tell a
   * pending poll apart from a failed one by catching would get it wrong.
   */
  poll(input: {
    serverUrl: string;
    handle: unknown;
    basicAuth?: BasicAuth;
    customHeader?: CustomHeader;
  }): Promise<{ auth: ProviderAuth; username: string } | null>;
  /** How often to poll, in milliseconds. */
  pollIntervalMs: number;
  /**
   * How long to keep polling before giving up. Both providers expire the code
   * server-side; without a client ceiling the screen would sit on "waiting for
   * approval" forever with nothing indicating the code had gone stale.
   */
  timeoutMs: number;
  /**
   * i18n key for the instruction telling the user where to enter the code.
   * A key rather than a string because this renders in the UI, and the
   * sentences it replaced were hardcoded English no locale could translate.
   */
  instructionKey: string;
  /** i18n key for the row that starts the flow. */
  actionKey: string;
};

/**
 * A server type's mark on the connect and server-list screens: the brand's own
 * logo, or — for a type with no brand, like local files — a glyph from the
 * app's icon library, drawn in the screen's colour.
 */
export type ServerProviderIcon =
  | { kind: 'image'; source: number }
  | { kind: 'glyph'; Glyph: ComponentType<{ size?: number; color?: string }> };

// `AddressProbe` — what an address answered before anyone signed in — is
// defined next to the probes that produce it (`server/addressProbe`), since
// telling those answers apart is their job.

export type ServerProviderConfig = {
  type: ServerType;
  label: string;
  description: string;
  icon: ServerProviderIcon;
  capabilities: ServerCapabilities;
  libraryScope: LibraryScope;
  /** The libraries/folders this server offers to scope the app to. */
  listLibraries: (server: Server) => Promise<Library[]>;
  /**
   * Checks an address before credentials are asked for, through the server's
   * public endpoint. Absent for a type with no address (local files).
   */
  probeAddress?: (url: string) => Promise<AddressProbe>;
  ping: (
    url: string,
    username: string,
    auth: ProviderAuth,
    basicAuth?: BasicAuth,
    customHeader?: CustomHeader
  ) => Promise<boolean>;
  connect: (
    url: string,
    username: string,
    password: string,
    basicAuth?: BasicAuth,
    customHeader?: CustomHeader
  ) => Promise<ConnectResult>;
  createAdapter: (server: Server) => ApiAdapter;
  buildCoverUrl: (server: Server, cover: CoverSource, px: number) => string | null;
  /**
   * Headers every media fetch against this server needs — the stream and its
   * artwork alike — when it sits behind something that authenticates each
   * request. Absent, or null for a server configured without it: signed-URL
   * and token servers need nothing added.
   */
  mediaAuthHeaders?: (server: Server) => Record<string, string> | null;
  /**
   * Address-screen hint naming this provider's usual port. Optional: without
   * one the screen shows the generic hint. It exists because a single shared
   * example is wrong for every provider but the one it was written for — it
   * named Navidrome's 4533 on the Plex screen, where the answer is 32400, so
   * a user following the app's own example could not reach their server.
   */
  addressHintKey?: string;
  /** Sign in by code instead of password, where the provider offers it. */
  codeAuth?: CodeAuthApi;
  demo?: () => Promise<DemoResult>;
};
