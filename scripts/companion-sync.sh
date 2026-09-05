#!/usr/bin/env bash
# Keeps an unpacked Yoink companion folder in step with the local app's
# packaged release. Run it on the machine that runs Chrome, pointing at the
# folder you loaded with "Load unpacked". When the app reports a newer
# release, the ZIP is downloaded over the loopback API, its SHA-256 verified,
# and its files extracted over the folder; the companion then reloads itself
# within a minute because the app's packaged versions no longer match its own.
#
#   YOINK_COMPANION_DIR=/path/to/companion bash scripts/companion-sync.sh          # keep running
#   YOINK_COMPANION_DIR=/path/to/companion bash scripts/companion-sync.sh --once   # one pass
#
# YOINK_API defaults to http://127.0.0.1:32991. If the app runs on another
# machine, forward that port first: ssh -N -L 32991:127.0.0.1:32991 <host>.
set -euo pipefail

API="${YOINK_API:-http://127.0.0.1:32991}"
DIR="${YOINK_COMPANION_DIR:-}"
INTERVAL="${YOINK_SYNC_INTERVAL:-60}"
ONCE=false
for arg in "$@"; do
  case "$arg" in
    --once) ONCE=true ;;
    *) echo "Unknown option $arg" >&2; exit 2 ;;
  esac
done
if [ -z "$DIR" ] || [ ! -f "$DIR/manifest.json" ]; then
  echo "Set YOINK_COMPANION_DIR to the unpacked companion folder (it must contain manifest.json)." >&2
  exit 2
fi
for tool in curl unzip; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required." >&2; exit 2; }
done
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
json_field() {
  # $1 = json text, $2 = field name; string and number values only.
  printf '%s' "$1" | tr -d '\n' | sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p"
}
installed_version() {
  json_field "$(cat "$DIR/manifest.json")" version
}

sync_once() {
  local descriptor version ready filename sha expected installed tmp
  descriptor="$(curl -fsS --max-time 10 "$API/api/v1/extension/release")" || { echo "$(date '+%H:%M:%S') app unreachable at $API"; return 1; }
  version="$(json_field "$descriptor" version)"
  ready="$(json_field "$descriptor" packageReady)"
  filename="$(json_field "$descriptor" filename)"
  expected="$(json_field "$descriptor" sha256)"
  installed="$(installed_version)"
  if [ "$ready" != "true" ] || [ -z "$filename" ]; then
    echo "$(date '+%H:%M:%S') app $version has no packaged release yet (installed $installed)"
    return 0
  fi
  if [ "$version" = "$installed" ]; then
    echo "$(date '+%H:%M:%S') companion $installed is current"
    return 0
  fi
  tmp="$(mktemp -t yoink-companion.XXXXXX.zip)"
  trap 'rm -f "$tmp"' RETURN
  curl -fsS --max-time 60 -o "$tmp" "$API/api/v1/extension/release/download"
  sha="$(sha256_of "$tmp")"
  if [ "$sha" != "$expected" ]; then
    echo "$(date '+%H:%M:%S') refused $filename: SHA-256 $sha does not match the app's $expected" >&2
    return 1
  fi
  unzip -o -q "$tmp" -d "$DIR"
  echo "$(date '+%H:%M:%S') installed $filename over $DIR (was $installed); the companion reloads itself within a minute"
}

if $ONCE; then sync_once; exit $?; fi
while true; do
  sync_once || true
  sleep "$INTERVAL"
done
