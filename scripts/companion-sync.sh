#!/usr/bin/env bash
# Keeps an unpacked Yoink companion folder in step with the local app's
# packaged release. Run it on the machine that runs Chrome, pointing at the
# folder you loaded with "Load unpacked". When the app reports a newer
# release (a different ZIP SHA-256, even at the same version), the ZIP is
# downloaded over the loopback API, its SHA-256 verified, and the folder made
# to match it exactly (rsync --delete); the companion then reloads itself
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
# JSON is parsed by a real parser, never sed (PLAT-24): node where the app or
# Chrome tooling lives, python3 otherwise.
if command -v node >/dev/null 2>&1; then
  JSON_TOOL=node
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL=python3
else
  echo "node or python3 is required to read the release descriptor." >&2
  exit 2
fi
HAVE_RSYNC=false
command -v rsync >/dev/null 2>&1 && HAVE_RSYNC=true
# The sha256 of the ZIP last installed into DIR. Freshness is the package
# content, not the manifest version: a rebuilt ZIP or a pack bump at the same
# version must still install (PLAT-08).
MARKER=".yoink-release.sha256"
# One work directory for the whole run (portable mktemp -d; GNU and macOS)
# and one EXIT trap, instead of a per-call RETURN trap.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/yoink-companion.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
json_field() {
  # $1 = json text, $2 = top-level field name; prints "" when absent.
  if [ "$JSON_TOOL" = node ]; then
    printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v===undefined||v===null?"":String(v));});' "$2"
  else
    printf '%s' "$1" | python3 -c 'import json,sys
v=json.load(sys.stdin).get(sys.argv[1])
sys.stdout.write("" if v is None else (("true" if v else "false") if isinstance(v,bool) else str(v)))' "$2"
  fi
}
installed_version() {
  json_field "$(cat "$DIR/manifest.json")" version
}
installed_sha() {
  if [ -f "$DIR/$MARKER" ]; then tr -d '[:space:]' < "$DIR/$MARKER"; fi
}

sync_once() {
  local descriptor version ready filename sha expected installed zip staged
  descriptor="$(curl -fsS --max-time 10 "$API/api/v1/extension/release")" || { echo "$(date '+%H:%M:%S') app unreachable at $API"; return 1; }
  version="$(json_field "$descriptor" version)" || { echo "$(date '+%H:%M:%S') unreadable release descriptor from $API" >&2; return 1; }
  ready="$(json_field "$descriptor" packageReady)"
  filename="$(json_field "$descriptor" filename)"
  expected="$(json_field "$descriptor" sha256)"
  installed="$(installed_version)"
  if [ "$ready" != "true" ] || [ -z "$filename" ] || [ -z "$expected" ]; then
    echo "$(date '+%H:%M:%S') app $version has no packaged release yet (installed $installed)"
    return 0
  fi
  if [ "$expected" = "$(installed_sha)" ]; then
    echo "$(date '+%H:%M:%S') companion $installed is current (${expected:0:12})"
    return 0
  fi
  rm -rf "${WORK:?}/"*
  zip="$WORK/release.zip"
  staged="$WORK/extracted"
  curl -fsS --max-time 60 -o "$zip" "$API/api/v1/extension/release/download"
  sha="$(sha256_of "$zip")"
  if [ "$sha" != "$expected" ]; then
    echo "$(date '+%H:%M:%S') refused $filename: SHA-256 $sha does not match the app's $expected" >&2
    return 1
  fi
  mkdir -p "$staged"
  unzip -q "$zip" -d "$staged"
  if [ ! -f "$staged/manifest.json" ]; then
    echo "$(date '+%H:%M:%S') refused $filename: the package has no manifest.json" >&2
    return 1
  fi
  if $HAVE_RSYNC; then
    # --delete removes files the new package no longer ships.
    rsync -a --delete --exclude "$MARKER" "$staged/" "$DIR/"
  else
    echo "$(date '+%H:%M:%S') rsync not found: files removed from the package stay in $DIR" >&2
    cp -R "$staged/." "$DIR/"
  fi
  printf '%s\n' "$expected" > "$DIR/$MARKER"
  echo "$(date '+%H:%M:%S') installed $filename (${expected:0:12}) over $DIR (was $installed); the companion reloads itself within a minute"
}

if $ONCE; then sync_once; exit $?; fi
while true; do
  sync_once || true
  sleep "$INTERVAL"
done
