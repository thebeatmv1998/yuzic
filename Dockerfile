# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — the web bundle.
#
# yuzic is a React Native app, and this produces its web target: the same
# screens, the same features, running in a browser through react-native-web.
# `expo export --platform web` emits a single-page bundle because `web.output`
# in app.json is `"single"` (the default, `"static"`, pre-renders every route in
# Node and dies on the first native module — `requireNativeComponent is not a
# function`).
#
# The native-only dependencies have no web build, so `metro.config.js` maps
# them to the shims under `src/web/shims/` for the `web` platform only. Nothing
# in this stage compiles native code.
#
# Debian rather than Alpine on purpose: a couple of the transitive deps fetch
# prebuilt native helpers during `npm ci`, and glibc avoids the musl build
# variants entirely. It costs a few megabytes in a stage that is thrown away.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# CI keeps the export non-interactive; telemetry is off so the build does not
# phone home from a self-hosted runner.
ENV CI=1 \
    EXPO_NO_TELEMETRY=1
RUN npx expo export --platform web --output-dir dist

# ---------------------------------------------------------------------------
# Runtime stage — nginx.
#
# `nginx-unprivileged` runs as the non-root `nginx` user and listens on 8080,
# so the container needs no capabilities and only writes its generated
# includes, cache and logs. The image's entrypoint substitutes ${...} variables
# in /etc/nginx/templates/*.template into /etc/nginx/conf.d/ — that is how the
# two reverse-proxy targets below get wired without baking an address in.
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine

# A CA bundle so an HTTPS upstream (`NAVIDROME_UPSTREAM=https://...`) is
# actually verified. Without it nginx would accept any certificate on the
# proxy-to-upstream hop, which is the hop most likely to cross a network.
RUN apk add --no-cache ca-certificates

COPY --from=build /app/dist /usr/share/nginx/html

COPY docker/default.conf.template /etc/nginx/templates/default.conf.template

# Security response headers (CSP, HSTS on HTTPS, frame/referrer/MIME
# protection) shared by the SPA and the proxy locations.
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf

# Generates the optional per-upstream auth-header includes before nginx
# starts. Runs from the image's own /docker-entrypoint.d hook, as the
# unprivileged nginx user, and writes outside conf.d so a custom header
# cannot leak to the wrong upstream.
COPY --chmod=0555 docker/entrypoint.d/10-upstream-headers.sh /docker-entrypoint.d/10-upstream-headers.sh
RUN mkdir -p /etc/nginx/upstream-headers \
    && chown nginx:nginx /etc/nginx/upstream-headers \
    && chmod 0700 /etc/nginx/upstream-headers

# Reverse-proxy targets, substituted into the nginx config at start-up.
# Point them at the Navidrome and Downtify you already run. The defaults are
# the usual Docker service names on a shared network; override them in
# docker-compose.yml or `docker run -e`.
ENV NAVIDROME_UPSTREAM="http://navidrome:4533" \
    DOWNTIFY_UPSTREAM="http://downtify:8000"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
