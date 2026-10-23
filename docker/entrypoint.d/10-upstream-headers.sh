#!/bin/sh
# Generate the per-upstream `proxy_set_header` includes from the environment.
#
# Why this exists: a custom header needed by a forward-auth proxy (Cloudflare
# Access, Authentik, Authelia, a plain API key, ...) must be attached to the
# login request. Doing that in the browser would put the secret in
# localStorage, where any script on the origin can read it, and `<audio>`
# cannot attach headers to a stream at all. nginx injects it instead: the
# secret stays in the container, and it covers login, API calls and streams.
#
# The generated files live outside /etc/nginx/conf.d on purpose. Everything in
# conf.d is included in the `http` block, where a `proxy_set_header` would
# apply to *every* upstream rather than the one it was written for.
#
# Configuration, per upstream (two headers are enough for Cloudflare Access):
#
#   NAVIDROME_HEADER_1_NAME=X-Api-Key
#   NAVIDROME_HEADER_1_VALUE=...            (or ..._VALUE_FILE=/run/secrets/...)
#   NAVIDROME_HEADER_2_NAME=...
#   NAVIDROME_HEADER_2_VALUE=...
#
# Same with the DOWNTIFY_ prefix. Values are validated before they are written
# into nginx syntax; a rejected value aborts start-up instead of producing a
# half-configured proxy. Secrets are never echoed to the log.
set -eu

OUT_DIR="${UPSTREAM_HEADER_OUT_DIR:-/etc/nginx/upstream-headers}"
umask 077

fail() {
    printf 'yuzic: %s\n' "$*" >&2
    exit 1
}

# Header names become nginx directives, so allow only the token characters a
# custom header actually uses. Anything else (spaces, CR/LF, quotes, `$`,
# `;`, `{`, `}`) is either a config-injection attempt or a typo.
validate_name() {
    name="$1"
    [ "${#name}" -ge 1 ] || return 1
    [ "${#name}" -le 64 ] || return 1
    case "$name" in
        *[!A-Za-z0-9_-]*) return 1 ;;
    esac

    # Hop-by-hop, framing and proxy headers must stay under nginx's control.
    # `Authorization` is intentionally allowed (a bearer token is a common
    # forward-auth credential); when the app's own reverse-proxy Basic Auth is
    # also configured, this header overrides it.
    lower=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')
    case "$lower" in
        host|connection|content-length|content-type|transfer-encoding|upgrade|te|trailer|keep-alive)
            return 1 ;;
        proxy-authorization|proxy-authenticate|cookie|set-cookie)
            return 1 ;;
        x-forwarded-for|x-forwarded-proto|x-forwarded-host|x-real-ip)
            return 1 ;;
    esac
    return 0
}

validate_value() {
    value="$1"
    [ "${#value}" -ge 1 ] || return 1
    [ "${#value}" -le 4096 ] || return 1

    # Printable ASCII only: a newline would end the nginx directive and could
    # inject another one. The remaining characters are nginx quoting hazards
    # or variable expansion. `grep` cannot see the newline itself (it ends the
    # line), so test for it separately.
    case "$value" in
        *'
'*) return 1 ;;
    esac
    if printf '%s' "$value" | LC_ALL=C grep -q '[^ -~]'; then
        return 1
    fi
    if printf '%s' "$value" | grep -q -e '"' -e '\\' -e '\$' -e ';' -e '{' -e '}'; then
        return 1
    fi
    return 0
}

write_upstream_headers() {
    prefix="$1"
    target="$OUT_DIR/$2"
    tmp="$target.tmp"

    : > "$tmp"
    n=1
    while [ "$n" -le 2 ]; do
        name=$(printenv "${prefix}_HEADER_${n}_NAME" 2>/dev/null || true)
        value=$(printenv "${prefix}_HEADER_${n}_VALUE" 2>/dev/null || true)
        value_file=$(printenv "${prefix}_HEADER_${n}_VALUE_FILE" 2>/dev/null || true)

        if [ -z "$name" ] && [ -z "$value" ] && [ -z "$value_file" ]; then
            n=$((n + 1))
            continue
        fi

        [ -n "$name" ] || fail "$prefix header $n: NAME is set but empty"
        [ -n "$value" ] || [ -n "$value_file" ] || fail "$prefix header $n: VALUE or VALUE_FILE is required"
        [ -z "$value" ] || [ -z "$value_file" ] || fail "$prefix header $n: set VALUE or VALUE_FILE, not both"

        if [ -n "$value_file" ]; then
            [ -r "$value_file" ] || fail "$prefix header $n: cannot read VALUE_FILE"
            value=$(cat "$value_file")
        fi

        validate_name "$name" || fail "$prefix header $n: invalid NAME (allowed: A-Z a-z 0-9 _ -, max 64; reserved names are rejected)"
        validate_value "$value" || fail "$prefix header $n: invalid VALUE (printable ASCII, no quotes, backslash, dollar, semicolon or braces)"

        printf 'proxy_set_header %s "%s";\n' "$name" "$value" >> "$tmp"
        n=$((n + 1))
    done

    chmod 600 "$tmp" 2>/dev/null || true
    mv "$tmp" "$target"
}

[ -d "$OUT_DIR" ] || fail "output directory does not exist: $OUT_DIR"

write_upstream_headers NAVIDROME navidrome.conf
write_upstream_headers DOWNTIFY downtify.conf

printf 'yuzic: upstream auth headers written to %s\n' "$OUT_DIR"
