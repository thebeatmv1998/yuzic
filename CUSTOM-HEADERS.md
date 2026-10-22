# Custom request headers

This fork adds up to eight configurable HTTP request headers per music server,
for servers behind a reverse proxy or SSO gateway that authenticates every
request with static headers (API keys, shared secrets, gateway tokens).

It is configured during onboarding under **Credentials → Custom request
headers**, and later in **Settings → Server → Custom request headers**. Each
row is one name/value pair; **Add header** appends another.

## Authentik

A typical Authentik forward-auth setup needs two headers, for example:

| Name | Value |
| --- | --- |
| `X-Authentik-Username` | the username your outpost expects |
| `X-Authentik-Groups` | the group or pipe-separated group list |

Authentik's outpost normally *sets* those headers after SSO; only configure
them on the client if your proxy configuration explicitly expects the client
to send them. If the outpost trusts client-supplied identity headers, make sure
it strips them from incoming requests — otherwise anyone can forge them.
`Authorization` remains reserved for the app's own credentials (provider token
or the reverse-proxy Basic-auth fields), so a Bearer token cannot be added as a
custom header.

## Cloudflare in front

Two different layers can produce a 403, and they need different headers:

- **Cloudflare Access (Zero Trust).** A machine client authenticates with a
  service token: `CF-Access-Client-Id` and `CF-Access-Client-Secret`, both
  added here. The Access policy's action must be **Service Auth**; with
  "Allow", Access redirects to the IdP even when a valid token is sent. With
  no token at all, expect a 302 to `<team>.cloudflareaccess.com` rather than
  an immediate 403.
- **Cloudflare proxy without Zero Trust.** Cloudflare does not authenticate
  anything here; a 403 is WAF / Bot Fight Mode / Browser Integrity Check / a
  rate-limit rule, or the origin itself. Check **Security → Events** for the
  `cf-ray`, then bypass Cloudflare (origin IP or grey-cloud DNS) and repeat the
  request. If the origin answers 200, Cloudflare is the blocker; if it also
  answers 403, the origin or Authentik is.

  **A 403 that never reaches the origin, with no Security Event, is often
  Browser Integrity Check or Bot Fight Mode rejecting a non-browser
  `User-Agent`.** React Native's Android networking sends OkHttp's default
  (`okhttp/…`); Navic, for comparison, sets `User-Agent: Navic`. Add a
  `User-Agent` row here to test that theory, or turn BIC/Bot Fight Mode off for
  the host (or add a WAF skip rule). If a custom app UA is accepted, the app can
  also send it by default.

If both Cloudflare Access and Authentik are in the chain, the service token
gets you past Cloudflare and Authentik still needs its own credential (Bearer
JWT or Basic app password). `X-Authentik-*` identity headers are set by the
outpost after a session; they are not a client credential.

## What it sends

The headers are attached to every request made against that server:

- sign-in and the connection test, including Jellyfin Quick Connect and the
  Plex server verification after PIN approval;
- every API call (library, playlists, scrobbles, radio, podcasts, …);
- audio streams and the engine's now-playing artwork;
- cover art drawn by the app.

They are **not** sent to anything that is not the user's server: not to
plex.tv, not to ListenBrainz, Last.fm, LRCLIB, Deezer, MusicBrainz, not to
artwork hosted on Cover Art Archive or a user-supplied URL.

## Security properties

- **Values are secrets and are stored like ones.** The whole list lives in the
  iOS Keychain / Android Keystore as `customHeaders`, never in Redux or MMKV.
  The `Server` record carries only the header *names*.
- **Values are never logged and never put in a URL.** Requests carry them in
  HTTP headers; the app has no code path that prints them.
- **Header injection is refused before storage.** Names must be RFC 7230 tokens;
  values may not contain CR, LF, NUL or any other control character.
- **The app's own headers cannot be displaced.** `Host`, `Content-Length`,
  `Content-Type`, `Transfer-Encoding`, `Connection`, `Authorization`, `Cookie`
  and the other framing/hop-by-hop headers are rejected. A reverse proxy's Basic
  auth still belongs in the dedicated proxy fields.
- **Names are unique.** A repeated name is refused rather than sent in an order
  nobody intended.
- **Size is bounded.** 128 bytes per name, 4096 per value, eight headers, and
  1900 bytes for the serialized list — the last is the practical Android
  SecureStore value limit, because the list is one keystore entry.
- **HTTP gets a warning.** Secrets sent over cleartext `http://` are readable
  on the network; use `https://`. The app supports LAN HTTP servers, so this
  warns rather than blocking, but HTTPS is the only safe choice for a secret.
- **Removal is immediate and complete.** Removing the headers deletes the
  keystore entry; removing the server deletes every credential scope it owns.
- **The first single-header format still works.** An install upgrading from the
  earlier APK keeps its one header until the next save, which migrates it into
  the list and deletes the old keystore entry.

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
