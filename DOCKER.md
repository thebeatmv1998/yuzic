# Self-hosting yuzic in a browser

This directory contains everything needed to run **yuzic** — the real app, its
screens and its features — in a browser, served from a container, connecting to
the Navidrome and Downtify you already run.

It is built the way [feishin's image](https://github.com/jeffvli/feishin) is:
a Node stage produces a web bundle, and `nginx-unprivileged` serves it. There is
one important difference, and it is the reason this is more than a Dockerfile:

> **feishin is a web app; yuzic is not.** feishin ships a real web build, so its
> image just runs it. yuzic is a React Native app for iOS and Android — its repo
> had no web target (no `Platform.OS === 'web'`, no `.web.*` files, and a
> dependency tree full of native-only modules). To run it in a browser at all,
> this adds a web target to it: a Metro resolver that shims the native modules,
> and a `PlayerBackend` that plays audio through an `HTMLAudioElement`. Those
> live in the source tree (see **What was changed**), not just in this folder.

---

## Quick start

### Direct HTTP (LAN only)

```bash
cp .env.example .env      # set NAVIDROME_UPSTREAM and DOWNTIFY_UPSTREAM
docker compose up -d --build
```

Open `http://<host>:8080`. Onboarding runs exactly as it does on a phone.
When it asks for a server, use the **proxied** URLs so the browser is
same-origin with your services and no CORS setup is required anywhere:

| Service  | Server URL to enter in yuzic        |
| -------- | ----------------------------------- |
| Navidrome | `http://<host>:8080/navidrome`     |
| Downtify  | `http://<host>:8080/downtify`      |

Plain HTTP is for a trusted LAN only. Do not publish port 8080 to the internet.

### HTTPS (recommended, required off-LAN)

The TLS overlay puts Caddy in front of the app and obtains a certificate
automatically:

```bash
# .env
YUZIC_DOMAIN=deck.example.com

docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

Point DNS for `YUZIC_DOMAIN` at the host and make sure ports **80** and **443**
are reachable. In yuzic, connect to `https://deck.example.com/navidrome` (and
`/downtify`). The app port is no longer published; only Caddy is exposed.

For a LAN-only hostname without a public certificate, use
`YUZIC_CADDYFILE=./docker/Caddyfile.internal` and trust Caddy's local root CA on
your devices — the exact command is at the top of that file.

The overlay needs Docker Compose **2.24 or newer** because it resets the
base service's published port.

---

## Custom auth header at login

Some setups require an extra header on the way to the music server: a
Cloudflare Access service token, an Authentik/Authelia forward-auth header, an
API key checked by a reverse proxy, and so on. yuzic can attach that header
without the browser ever seeing the secret.

### Why nginx injects it

- The login request is sent by the browser. A header configured in the app
  would have to be stored in `localStorage`, where any script on the origin can
  read it.
- `<audio>` cannot attach custom headers to a stream at all. A browser-side
  header would authenticate the login and then fail on playback.
- nginx injects the header into **every** request it proxies to that upstream:
  address probe, login, API calls, artwork and audio streams. The secret stays
  in the container and is never shipped to a client.

### Configure it

Set the name/value pair in `.env`. Names may contain letters, digits and `-`,
up to 64 characters. Values are printable ASCII, up to 4096 characters, and
must not contain `"`, `\`, `$`, `;`, `{` or `}`. Hop-by-hop headers, `Host`,
`Content-*`, `Cookie` and `X-Forwarded-*` are rejected. Two headers per
upstream are supported.

Cloudflare Access example:

```bash
NAVIDROME_HEADER_1_NAME=CF-Access-Client-Id
NAVIDROME_HEADER_1_VALUE=xxxxxxxxxxxxxxxx.access
NAVIDROME_HEADER_2_NAME=CF-Access-Client-Secret
NAVIDROME_HEADER_2_VALUE=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

A single API key:

```bash
NAVIDROME_HEADER_1_NAME=X-Api-Key
NAVIDROME_HEADER_1_VALUE=...
```

Then rebuild/restart:

```bash
docker compose up -d --build
```

The header is applied when the app connects through the proxied URL
(`/navidrome`), not when it points directly at another origin.

### Keep the secret out of `docker inspect`

Environment variables are visible to anyone who can inspect the container. For
a real deployment, mount the value as a file and use `_VALUE_FILE`:

```yaml
services:
  yuzic:
    secrets:
      - navidrome_header

secrets:
  navidrome_header:
    file: ./secrets/navidrome_header
```

```bash
# .env — one line, no trailing newline needed
NAVIDROME_HEADER_1_NAME=X-Api-Key
NAVIDROME_HEADER_1_VALUE_FILE=/run/secrets/navidrome_header
```

`./secrets/navidrome_header` should be mode `600`, owned by the user running
Compose. The generated nginx include is written with mode `600` inside the
container as well.

Set `VALUE` or `VALUE_FILE`, never both. Invalid configuration stops the
container at start-up with an error rather than silently proxying without the
header; secret values are never printed.

### The origin itself must be protected

This is the part that is easy to get wrong: injecting a service credential at
the proxy makes **the proxy** an authenticated client for the upstream. Anyone
who can reach `https://<host>/navidrome/` can use the injected header, whether
or not they know its value.

- Put the whole yuzic instance behind SSO, forward auth, HTTP Basic auth or an
  IP allowlist. Only then is the injected header an additional factor.
- Do not expose `/navidrome` or `/downtify` as open endpoints. Downtify's API
  has no authentication of its own.
- The app's own login still applies on top; the header does not replace the
  Navidrome/Jellyfin account.

### Verify it

Browser DevTools will **not** show the injected header: it is added after the
request leaves the browser. Check the upstream or forward-auth proxy log
instead. Security response headers are visible:

```bash
curl -sSI https://deck.example.com | grep -Ei \
  'strict-transport|content-security|x-frame|x-content-type|referrer-policy'
```

Start-up errors look like:

```
yuzic: NAVIDROME header 1: invalid VALUE (printable ASCII, no quotes, ...)
```

---

## How the container is put together

```
Dockerfile
├─ build stage   node:22  →  npm ci
│                           expo export --platform web  →  /app/dist   (a static SPA)
└─ runtime stage nginx-unprivileged:1.27-alpine
                  /app/dist  →  /usr/share/nginx/html
                  docker/default.conf.template → /etc/nginx/templates/…  (envsubst)
                  docker/security-headers.conf → /etc/nginx/snippets/
                  docker/entrypoint.d/10-upstream-headers.sh → generated includes
```

- **SPA, not SSR.** `web.output` in `app.json` is `"single"`. The default
  (`"static"`) pre-renders each route in Node, which immediately hits
  `requireNativeComponent is not a function` on the first native module. A
  single-page bundle is also exactly what an nginx `try_files … /index.html`
  fallback wants.
- **Nothing native compiles.** The build stage only bundles JavaScript.
- **`nginx-unprivileged`** runs as a non-root user on port 8080, so the
  container needs no capabilities.
- **The proxies are configurable** through `NAVIDROME_UPSTREAM` /
  `DOWNTIFY_UPSTREAM`, substituted into the nginx config by the image's own
  template entrypoint.

### Why the reverse proxies

A browser client has to fetch the music server's API and stream its audio from a
different origin than the app, which means **CORS**. Rather than ask you to
reconfigure Navidrome and Downtify, nginx proxies them onto the yuzic origin at
`/navidrome` and `/downtify`. The app's server URL is then just
`http://<host>:8080/navidrome`, everything is same-origin, and it works whether
or not the services send CORS headers.

You can skip the proxy and point yuzic straight at a server — it is the same
flow as the phone app — but then that server must allow your yuzic origin via
CORS, and streams are cross-origin.

---

## What was changed in the source

All additive; the iOS and Android builds are untouched. The web-only pieces are
gated on the `web` platform.

| Path | What it does |
| --- | --- |
| `app.json` | `web.output` `"static"` → `"single"` (web only). |
| `package.json` | Adds `build:web`. |
| `metro.config.js` | On `web`, resolves native-only packages to the shims below. |
| `src/web/shims/*` | Web stand-ins for `react-native-mmkv` (localStorage), `expo-secure-store` (localStorage), `react-native-turbo-image` (`Image`), `react-native-image-colors`, `react-native-udp`, `@missingcore/audio-metadata`, `react-native-restart`, `react-native-exception-handler`, `@react-native-community/slider` (`<input type=range>`), `react-native-reorderable-list` (`FlatList`), `yuzic-engine`. |
| `src/features/player/createEngineBackend.web.ts` | The browser player: the `PlayerBackend` interface implemented on `HTMLAudioElement`. |
| `src/features/player/playingBar/PlayingBar.web.tsx` | Was an empty file, which crashed the first render (`<PlayingBar/>` resolved to `{}`). Now renders `PlayingBarBase` like iOS/Android do. |
| `src/app/(onboarding)/_layout.tsx` | Web only: the onboarding flow is centred and capped at the app's own readable width, so its full-width buttons and rows do not stretch across a desktop window. |
| `docker/security-headers.conf` | CSP, HSTS (HTTPS only), frame/referrer/MIME/permissions headers. |
| `docker/entrypoint.d/10-upstream-headers.sh` | Turns `NAVIDROME_HEADER_*` / `DOWNTIFY_HEADER_*` into validated nginx includes. |
| `docker-compose.tls.yml`, `docker/Caddyfile*` | Optional Caddy TLS front end, public CA or local CA. |

The app behind onboarding was already responsive — it caps a column of content
at `contentWidth.readable` (720), centres it, and goes two-column from 840 — so
the library, detail screens and player lay out correctly at any window size.
Only the first-run flow needed the cap above.

---

## What works, and what does not

The app was built for a phone's audio engine, gestures and OS keystore. The
catalogue, the API clients and the screens are the real ones — unchanged. The
parts that lean on the OS do not survive a browser.

### Works

- Onboarding, connecting to **Navidrome** (any Subsonic server), and (via the
  proxied paths) **Downtify**.
- Browsing the library: artists, albums, tracks, playlists, genres, search,
  ratings, favourites, radio, podcasts, shares, wants.
- **Playback** — play/pause, seek, next/previous, repeat, volume, speed, sleep
  timer — through the browser's audio element, streamed from your server.
- **Integrations**: Deezer, MusicBrainz, Cover Art Archive, Last.fm, LRCLIB,
  ListenBrainz, and **AudioMuse-AI** — these are HTTP, so they behave as they do
  on the phone.
- **Downloaders**: Lidarr, slskd, SoulSync, and **Downtify** — likewise.
- Settings, themes, appearance, and persistence (in `localStorage`).

### Does not work (and why)

- **Crossfade, the 10-band equalizer, and ReplayGain/loudness normalisation.**
  These are yuzic-engine's DSP. A plain `<audio>` element has none of it, and a
  `WebAudio` graph would break playback on any stream that is not CORS-clean.
  The controls are present and remember your choice; they just have no effect.
- **Per-request headers on the stream.** `MediaItem.headers` cannot be attached
  to `<audio>`, so a server behind HTTP Basic auth must carry the credential in
  the URL instead. A custom forward-auth header is handled by nginx (see above),
  which is why that path works for streams.
- **Local file import** (`@missingcore/audio-metadata`) and **offline
  downloads** — no arbitrary filesystem in a browser.
- **AirPlay, DLNA/UPnP and CarPlay/Android Auto.** DLNA's SSDP discovery is UDP,
  which pages cannot send; a renderer added *by IP* is probed over HTTP and may
  still work.
- **mTLS client certificates.** A browser cannot present one to `fetch`.
- **The OS keystore.** Credentials go to `localStorage` — readable by any script
  on the origin. See **Security**.
- **Drag-to-reorder** in the queue and playlist editor (native gesture). The
  lists render and scroll.

---

## Security

### Transport

- Use the TLS overlay (or your own TLS-terminating proxy) for anything beyond a
  trusted LAN. HSTS is emitted only when the request arrived over HTTPS, so the
  direct HTTP mode does not pin a host that has no certificate.
- HSTS includes `includeSubDomains` (one year). If other subdomains of the same
  domain are still HTTP-only, remove that token from
  `docker/security-headers.conf` before deploying.
- Caddy gets and renews certificates automatically; HTTP/3 is available on
  `443/udp`. For LAN hostnames, trust the local CA root instead of clicking
  through warnings.
- When an upstream is HTTPS (`NAVIDROME_UPSTREAM=https://...`), nginx verifies
  its certificate against the image's CA store. A self-signed upstream needs
  its CA added to that store (or TLS terminated in front of it).

### Browser origin

- The web build stores server passwords, API keys and tokens in
  `localStorage`, **not** the OS keychain — the honest ceiling for a page. Serve
  it over HTTPS and treat the origin as trusted. Anyone with script execution on
  the origin can read those credentials.
- A strict Content-Security-Policy (`script-src 'self'`) blocks inline and
  third-party scripts. This is the main defence against an XSS bug turning into
  credential theft. `style-src` allows inline styles because React Native Web
  injects them at runtime.
- The SPA shell is served `no-store`; hashed assets are immutable.
- Access logs omit query strings. Subsonic authentication puts a token and salt
  in the URL, and logging `$request` would leak working credentials.
- `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `frame-ancestors 'none'`, `nosniff`, a restrictive `Permissions-Policy`, and
  `Cross-Origin-Opener-Policy: same-origin` are set on every response.

### Container

- nginx runs as the unprivileged `nginx` user on port 8080.
- Compose drops **all** Linux capabilities, sets `no-new-privileges`, and limits
  PIDs and memory. The app needs none of them.
- The image reads only its own static files; the only writable state is the
  generated nginx include directory (mode `700`), nginx's cache and its logs.
- `.env`, secrets and Compose files are excluded from the Docker build context;
  no secret is baked into an image layer.
- Header values can be supplied as Docker secrets instead of environment
  variables, and the generated include is mode `600`.

### Operational

- **Protect the yuzic origin.** The `/navidrome` and `/downtify` proxies are
  reachable by anyone who can reach the app. A custom header injected there is
  usable by those same people. Put SSO/basic auth/IP allowlisting in front.
- Downtify's API has **no authentication**. Proxying it at `/downtify` means
  anything that can reach your yuzic host can queue downloads on it.
- Keep the base image and npm dependencies updated; rebuild with `--pull` and
  scan the image (for example `docker scout cves yuzic-web:local` or Trivy).
  `npm ci` installs strictly from the lockfile.
- Back up `caddy_data` if you use the TLS overlay; it contains the account key
  and, for the internal CA, the root key.

---

## Troubleshooting

- **A blank page / "Something went wrong".** Check the browser console. The dev
  overlay only exists with `expo start --web`; the container ships the production
  bundle. If the page is blank only after enabling the CSP, open DevTools and
  look for a `Content-Security-Policy` violation before changing the header.
- **`/navidrome` returns 502.** `NAVIDROME_UPSTREAM` is not reachable from inside
  the container. From a container, `localhost` is the container — use
  `host.docker.internal` (as `.env.example` does) or the service's network name.
- **Login fails while the header is configured.** Check the container log for a
  `yuzic: ... header ...` line (the container refuses to start on invalid
  configuration). Remember the header is only injected for the `/navidrome`
  proxy URL, not for a server entered with a different host.
- **Music won't play.** Open the network tab; a stream request that fails is
  usually the upstream address, not the player. If you connected yuzic directly
  to a server (not through `/navidrome`), it is CORS.
- **Certificate warning with the internal Caddyfile.** Trust
  `/data/caddy/pki/authorities/local/root.crt` on the client; see the top of
  `docker/Caddyfile.internal`.
- **Rebuilding after a source change.** `docker compose up -d --build`. The
  bundle is baked into the image.

## Local development

```bash
npm ci
npm run web        # dev server on :8081 with hot reload
npm run build:web  # the same static bundle the Dockerfile produces, into dist/

# Parser/validator tests for the login-header config (no Docker needed)
sh docker/test-upstream-headers.sh
```
