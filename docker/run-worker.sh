#!/bin/sh
set -eu

# Wrangler reads only the bindings listed in docker/wrangler.jsonc from the
# process environment. An empty env file prevents dotenv parsing and expansion.
export PUBLIC_ASSET_ORIGIN="$PUBLIC_URL/bilder" GALLERY_PREFIX=gallery/ AUTH_MODE
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
export CF_ACCESS_TEAM_DOMAIN="${CF_ACCESS_TEAM_DOMAIN:-}" CF_ACCESS_AUD="${CF_ACCESS_AUD:-}"
export WORKERS_API_TOKEN="${WORKERS_API_TOKEN:-}" CF_ACCESS_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=true
vars=$(mktemp)

cd "$1"
exec npx wrangler dev --local --persist-to "$2" \
  --ip 0.0.0.0 --port "${PORT:-8787}" \
  --env-file "$vars" --show-interactive-dev-session=false
