#!/bin/sh
# Start Fundstelle against a throwaway copy of the test fixtures, so that
# walking the product never writes into somebody's real study. Codings are
# written beside the transcripts, so a server started on the default folder
# would leave coding.json files in data/transcripts/ — this is the reason the
# folder is always a copy and always disposable.
#
#   sandbox.sh                 two fixture interviews, German, port 4200
#   sandbox.sh --empty         no transcripts at all — the first-run screen
#   sandbox.sh --lang en       seed and start the interface in English
#   sandbox.sh --port 4201     a second one beside the first
#   sandbox.sh --keep          reuse the last sandbox instead of resetting it
#
# It prints the URL and the sandbox path, then runs in the foreground.

set -e

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)

PORT=4200
LANG_CHOICE=de
EMPTY=no
KEEP=no

while [ $# -gt 0 ]; do
  case "$1" in
    --empty) EMPTY=yes ;;
    --keep) KEEP=yes ;;
    --lang) LANG_CHOICE=$2; shift ;;
    --port) PORT=$2; shift ;;
    *) echo "sandbox.sh: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

SANDBOX="${TMPDIR:-/tmp}fundstelle-po-$PORT"

if [ "$KEEP" = no ]; then
  rm -rf "$SANDBOX"
  mkdir -p "$SANDBOX"
  if [ "$EMPTY" = yes ]; then
    mkdir -p "$SANDBOX/transcripts"
  else
    cp -R "$ROOT/tests/fixtures" "$SANDBOX/transcripts"
  fi
fi

echo "sandbox   $SANDBOX"
echo "open      http://127.0.0.1:$PORT"
echo

TRANSCRIPTS="$SANDBOX/transcripts" \
CATEGORIES="$SANDBOX/categories.json" \
START_LANGUAGE="$LANG_CHOICE" \
PORT="$PORT" \
  exec node "$ROOT/server.js"
