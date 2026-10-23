#!/bin/sh
# Tests for docker/entrypoint.d/10-upstream-headers.sh.
#
# Run from the repository root:
#   sh docker/test-upstream-headers.sh
#
# Needs a POSIX shell and the usual busybox/coreutils tools; no Docker and no
# network. It exercises the parser/validator only, not nginx itself.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
script="$here/entrypoint.d/10-upstream-headers.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

failures=0

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    failures=$((failures + 1))
}

expect_line() {
    file="$1"
    line="$2"
    if ! grep -qxF "$line" "$file"; then
        fail "$file does not contain: $line"
        sed 's/^/  got: /' "$file" >&2 || true
    fi
}

expect_ok() {
    dir="$1"
    shift
    if ! env UPSTREAM_HEADER_OUT_DIR="$dir" "$@" sh "$script" >/dev/null 2>&1; then
        fail "expected success: $*"
    fi
}

expect_fail() {
    dir="$1"
    shift
    if env UPSTREAM_HEADER_OUT_DIR="$dir" "$@" sh "$script" >/dev/null 2>&1; then
        fail "expected failure: $*"
    fi
}

mkdir "$tmp/empty"
expect_ok "$tmp/empty"
[ -f "$tmp/empty/navidrome.conf" ] || fail 'empty run did not create navidrome.conf'
[ -f "$tmp/empty/downtify.conf" ] || fail 'empty run did not create downtify.conf'
[ ! -s "$tmp/empty/navidrome.conf" ] || fail 'unset header produced a directive'

mkdir "$tmp/one"
expect_ok "$tmp/one" \
    NAVIDROME_HEADER_1_NAME=X-Api-Key \
    NAVIDROME_HEADER_1_VALUE='abc123'
expect_line "$tmp/one/navidrome.conf" 'proxy_set_header X-Api-Key "abc123";'
[ ! -s "$tmp/one/downtify.conf" ] || fail 'Navidrome header leaked into Downtify'

mkdir "$tmp/underscore"
expect_ok "$tmp/underscore" \
    NAVIDROME_HEADER_1_NAME=X_Api_Key \
    NAVIDROME_HEADER_1_VALUE='abc123'
expect_line "$tmp/underscore/navidrome.conf" 'proxy_set_header X_Api_Key "abc123";'

mkdir "$tmp/two"
expect_ok "$tmp/two" \
    NAVIDROME_HEADER_1_NAME=CF-Access-Client-Id \
    NAVIDROME_HEADER_1_VALUE='id.access' \
    NAVIDROME_HEADER_2_NAME=CF-Access-Client-Secret \
    NAVIDROME_HEADER_2_VALUE='secret'
expect_line "$tmp/two/navidrome.conf" 'proxy_set_header CF-Access-Client-Id "id.access";'
expect_line "$tmp/two/navidrome.conf" 'proxy_set_header CF-Access-Client-Secret "secret";'

mkdir "$tmp/file"
printf '%s' 'from-a-file' > "$tmp/secret"
expect_ok "$tmp/file" \
    DOWNTIFY_HEADER_1_NAME=X-Api-Key \
    DOWNTIFY_HEADER_1_VALUE_FILE="$tmp/secret"
expect_line "$tmp/file/downtify.conf" 'proxy_set_header X-Api-Key "from-a-file";'

mkdir "$tmp/badname"
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='X Api Key' \
    NAVIDROME_HEADER_1_VALUE='abc'
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='Host' \
    NAVIDROME_HEADER_1_VALUE='evil'
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='X-Api-Key' \
    NAVIDROME_HEADER_1_VALUE='a;b'
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='X-Api-Key' \
    NAVIDROME_HEADER_1_VALUE='a"b'
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='X-Api-Key' \
    NAVIDROME_HEADER_1_VALUE='a$b'
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='X-Api-Key' \
    NAVIDROME_HEADER_1_VALUE='line1
line2'
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='X-Api-Key' \
    NAVIDROME_HEADER_1_VALUE='abc' \
    NAVIDROME_HEADER_1_VALUE_FILE="$tmp/secret"
expect_fail "$tmp/badname" \
    NAVIDROME_HEADER_1_NAME='X-Api-Key' \
    NAVIDROME_HEADER_1_VALUE_FILE="$tmp/does-not-exist"

if [ "$failures" -gt 0 ]; then
    printf '%s test(s) failed\n' "$failures" >&2
    exit 1
fi
printf 'upstream header parser: all tests passed\n'
