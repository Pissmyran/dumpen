#!/bin/sh
# Renders the gallery with the values from the container environment and
# serves the Worker with R2 stored under /data. Nothing is baked into the image.
set -eu

# Saved settings from a one-time /data/import.env (see import-settings.sh).
# shellcheck source=docker/import-settings.sh
. /opt/app/docker/import-settings.sh

: "${PUBLIC_URL:=http://localhost:8787}"
PUBLIC_URL=${PUBLIC_URL%/}
: "${AUTH_MODE:=password}"
case "$AUTH_MODE" in
  password)
    [ "${#ADMIN_PASSWORD}" -ge 8 ] 2>/dev/null ||
      { echo "AUTH_MODE=password needs ADMIN_PASSWORD (at least 8 characters)." >&2; exit 1; } ;;
  cloudflare-access)
    [ -n "${CF_ACCESS_TEAM_DOMAIN:-}" ] && [ -n "${CF_ACCESS_AUD:-}" ] ||
      { echo "AUTH_MODE=cloudflare-access needs CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD." >&2; exit 1; } ;;
  *) echo "AUTH_MODE must be password or cloudflare-access." >&2; exit 1 ;;
esac

# Placeholder values; the bucket names match docker/wrangler.jsonc.
export PUBLIC_ORIGIN="$PUBLIC_URL"
PUBLIC_HOST=$(printf '%s' "$PUBLIC_URL" | sed 's|^[a-z]*://||; s|/.*||')
export PUBLIC_HOST GALLERY_BUCKET=gallery LEGACY_BUCKET=legacy SECRETS_STORE_ID=local
export CF_ACCESS_TEAM_DOMAIN="${CF_ACCESS_TEAM_DOMAIN:-}" CF_ACCESS_AUD="${CF_ACCESS_AUD:-}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"

app=/opt/app
values=$(mktemp)
sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p' "$app/cloudflare.example.env" | while read -r name; do
  printf '%s=%s\n' "$name" "$(printenv "$name" || true)"
done >"$values"

site=/srv/site
node /opt/app/tools/render.mjs "$values" "$site" >/dev/null
cp "$app/docker/wrangler.jsonc" "$site/wrangler.jsonc"

export PUBLIC_URL AUTH_MODE
exec /opt/app/docker/run-worker.sh "$site" /data
