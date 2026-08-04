#!/bin/sh
# Checks the two ways the container meets a data folder it did not create.
#
# Both are invisible on macOS, where Docker Desktop papers over ownership, and
# both are what a Linux reader meets first — so they are worth a script rather
# than a paragraph in the README that nobody re-runs.
#
#   npm run test:docker
set -e

IMAGE=fundstelle:smoke
PORT=${PORT:-4192}
ROOT_VOLUME=fundstelle-smoke-root
LOCKED_VOLUME=fundstelle-smoke-locked

cleanup() {
  docker rm -f fundstelle-smoke-a fundstelle-smoke-b >/dev/null 2>&1 || true
  docker volume rm -f "$ROOT_VOLUME" "$LOCKED_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "Building $IMAGE"
docker build -q -t "$IMAGE" . >/dev/null

# A volume owned by root is what `docker compose up` leaves behind when ./data
# does not exist yet. The entrypoint has to hand it over.
echo "1/2 a root-owned data folder is taken over"
docker volume create "$ROOT_VOLUME" >/dev/null
docker run --rm -v "$ROOT_VOLUME":/data alpine chown 0:0 /data
docker run -d --name fundstelle-smoke-a -p "127.0.0.1:$PORT:4173" \
  -v "$ROOT_VOLUME":/data "$IMAGE" >/dev/null
sleep 4

docker exec fundstelle-smoke-a ps -o user,args | grep -q '^node .*server.js' \
  || fail "the server should run as node, not as root"

curl -fsS -m 5 "http://127.0.0.1:$PORT/api/categories" >/dev/null \
  || fail "seeding the category system failed on a root-owned folder"
echo "    ok — seeded, and the server runs as node"

# Given a user of its own the entrypoint must not try to take ownership. The
# tool then says what is wrong instead of dumping a stack trace.
echo "2/2 a folder it may not write to is explained, not dumped"
docker volume create "$LOCKED_VOLUME" >/dev/null
docker run --rm -v "$LOCKED_VOLUME":/data alpine chown 0:0 /data
docker run -d --name fundstelle-smoke-b --user 1000:1000 \
  -p "127.0.0.1:$((PORT + 1)):4173" -v "$LOCKED_VOLUME":/data "$IMAGE" >/dev/null
sleep 4

body=$(curl -sS -m 5 "http://127.0.0.1:$((PORT + 1))/api/categories" || true)
echo "$body" | grep -q errorDataNotWritable \
  || fail "expected a named error, got: $body"
docker logs fundstelle-smoke-b 2>&1 | grep -q "is not writable" \
  || fail "the startup check should warn before the first click"
if docker logs fundstelle-smoke-b 2>&1 | grep -q "at async"; then
  fail "a named case should not also dump a stack trace"
fi
echo "    ok — warned at startup, named error, no stack trace"

echo "Docker smoke test passed"
