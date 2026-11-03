#!/bin/sh
# Run against a locally built image: sh tests/docker-explorer.sh <image>
# Uses Docker host networking on Linux so the test can choose a free port.
set -eu

image=${1:?provide a locally built image}
port=$(node -e 'const s = require("net").createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });')
tmp=$(mktemp -d)
container=
cleanup() {
  [ -z "$container" ] || docker rm -fv "$container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

check_status() {
  check_expected=$1
  shift
  actual=$(curl -sS -o /dev/null -w '%{http_code}' "$@")
  [ "$actual" = "$check_expected" ] || { echo "Expected $check_expected, got $actual" >&2; exit 1; }
}

for scenario in password-default password-override access-override; do
  set -- -e AUTH_MODE=password -e ADMIN_PASSWORD=synthetic-test-password
  expected=303
  if [ "$scenario" = access-override ]; then
    set -- -e AUTH_MODE=cloudflare-access -e CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com \
      -e CF_ACCESS_AUD=synthetic-audience
    expected=403
  fi
  [ "$scenario" = password-default ] || set -- "$@" -e X_LOCAL_EXPLORER=true
  container=$(docker run -d --network host -e "PORT=$port" \
    -e "PUBLIC_URL=http://localhost:$port" "$@" "$image")
  url="http://localhost:$port"
  ready=false
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    if curl -sS -o /dev/null "$url/bilder/x" 2>/dev/null; then ready=true; break; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$container")" != true ]; then
      docker logs "$container" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  [ "$ready" = true ] || { echo 'Container did not become ready' >&2; exit 1; }

  if [ "$scenario" = access-override ]; then
    check_status 403 "$url/api/r2/items?source=legacy"
  else
    check_status 401 "$url/api/r2/items?source=legacy"
  fi
  for path in /cdn-cgi/local/explorer /cdn-cgi/explorer; do
    check_status "$expected" "$url$path/api/r2/buckets"
    for method in GET PUT DELETE; do
      check_status "$expected" -X "$method" "$url$path/api/r2/buckets/gallery/objects/test.png"
    done
  done
  if [ "$scenario" != access-override ]; then
    check_status 303 -c "$tmp/cookies" -d 'password=synthetic-test-password' "$url/auth/login"
    check_status 200 -b "$tmp/cookies" "$url/api/r2/items?source=legacy"
  fi
  docker rm -fv "$container" >/dev/null
  container=
done
