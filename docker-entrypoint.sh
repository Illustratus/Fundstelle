#!/bin/sh
# Hands the data folder to the user the tool runs as, and then steps aside.
#
# `docker compose up` with no ./data yet leaves a folder owned by root, while
# the tool runs as `node`. Without this the first coding fails with EACCES —
# invisible on macOS, where Docker Desktop papers over ownership, and the first
# thing a Linux reader meets. So: if we start as root, fix the folder once and
# drop privileges; if we were already given a user of our own, there is nothing
# to hand over and we simply run.
set -e

# Where data lands. The container's own defaults are applied here rather than in
# the Dockerfile, because an `ENV` in the image cannot be told apart from a
# setting the caller made — and one set by the image always won. That quietly
# disabled the German variable names of earlier versions: a compose file naming
# `TRANSKRIPTE` never beat the `TRANSCRIPTS` the image had set for itself, so
# the tool read an empty folder and showed a study without a single interview
# in it, next to a volume holding all of them.
TRANSCRIPTS="${TRANSCRIPTS:-${TRANSKRIPTE:-/data/transcripts}}"
CATEGORIES="${CATEGORIES:-${KATEGORIEN:-/data/categories.json}}"
export TRANSCRIPTS CATEGORIES

DATA_DIRS="$(dirname "$CATEGORIES") $TRANSCRIPTS"

if [ "$(id -u)" = "0" ]; then
  for folder in $DATA_DIRS; do
    mkdir -p "$folder"
    # Only take ownership when it is actually in the way. A recursive chown over
    # a study's worth of transcripts on every start would be a slow surprise.
    if ! su-exec node:node test -w "$folder"; then
      echo "Handing $folder to the node user"
      chown -R node:node "$folder"
    fi
  done
  exec su-exec node:node "$@"
fi

# Started with a user of its own: the folder is the caller's business. The tool
# says so at startup if it cannot write, so nothing fails silently.
exec "$@"
