# Custom request header

This fork adds one configurable HTTP request header per music server, for
servers behind a reverse proxy or SSO gateway that authenticates every request
with a static header (an API key, a shared secret, a gateway token).

It is configured during onboarding under **Credentials → Custom request
header**, and later in **Settings → Server → Custom request header**.

## What it sends

The header is attached to every request made against that server:

- sign-in and the connection test, including Jellyfin Quick Connect and the
  Plex server verification after PIN approval;
- every API call (library, playlists, scrobbles, radio, podcasts, …);
- audio streams and the engine's now-playing artwork;
- cover art drawn by the app.

It is **not** sent to anything that is not the user's server: not to plex.tv,
not to ListenBrainz, Last.fm, LRCLIB, Deezer, MusicBrainz, not to artwork hosted
on Cover Art Archive or a user-supplied URL.

## Security properties

- **The value is a secret and is stored like one.** It lives in the iOS
  Keychain / Android Keystore as `customHeaderValue`, never in Redux or MMKV.
  The `Server` record carries only the header *name*.
- **The value is never logged and never put in a URL.** Requests carry it in an
  HTTP header; the app has no code path that prints it.
- **Header injection is refused before storage.** Names must be RFC 7230 tokens;
  values may not contain CR, LF, NUL or any other control character.
- **The app's own headers cannot be displaced.** `Host`, `Content-Length`,
  `Content-Type`, `Transfer-Encoding`, `Connection`, `Authorization`, `Cookie`
  and the other framing/hop-by-hop headers are rejected. A reverse proxy's Basic
  auth still belongs in the dedicated proxy fields.
- **Both halves are length-bounded** (128 bytes for a name, 4096 for a value).
- **HTTP gets a warning.** A secret sent over cleartext `http://` is readable on
  the network; use `https://`. The app supports LAN HTTP servers, so this warns
  rather than blocking, but HTTPS is the only safe choice for a secret.
- **Removal is immediate and complete.** Removing the header deletes the
  keystore entry; removing the server deletes every credential scope it owns.

## Maintenance

The implementation points are:

| Concern | File |
| --- | --- |
| Validation and request record | `src/providers/http/customHeader.ts` |
| Keystore field and sanitisation | `src/state/credentials.ts`, `src/providers/registry/serverCredentials.ts` |
| Onboarding UI | `src/features/onboarding/credentials/CustomHeaderSection.tsx` |
| Settings UI | `src/features/settings/server/components/CustomHeaderCard.tsx` |
| Server request headers | `src/providers/server/{navidrome,media-browser,plex}/` |
| Player stream/artwork headers | `src/features/player/mediaHeaders.ts` |
| On-screen cover headers | `src/providers/registry/covers.ts` |

Run the same gates as upstream before shipping:

```sh
npx tsc --noEmit
npm run lint
npx jest --ci
npm run architecture:check
```

## Updating from upstream

```sh
git fetch origin
git merge origin/master   # or rebase the fork branch
```

`origin` points at this fork; add the upstream repository as a second remote if
you cloned only the fork:

```sh
git remote add upstream https://github.com/yuzicapp/yuzic.git
```
