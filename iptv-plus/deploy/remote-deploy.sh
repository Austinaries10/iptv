#!/usr/bin/env bash
# Runs ON the VPS (piped over SSH by .github/workflows/deploy-iptv-plus.yml).
# Expects IMAGE, APP_DIR, GHCR_USER and GHCR_TOKEN to be exported before this script.
set -euo pipefail
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "Missing $APP_DIR/.env — create it from iptv-plus/deploy/env.example (at least PASSWORD=...)" >&2
  exit 1
fi

# Remember the deployed image in .env so a manual `docker compose up -d` keeps working
if grep -q '^IPTV_PLUS_IMAGE=' .env; then
  sed -i "s#^IPTV_PLUS_IMAGE=.*#IPTV_PLUS_IMAGE=$IMAGE#" .env
else
  printf '\nIPTV_PLUS_IMAGE=%s\n' "$IMAGE" >> .env
fi

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
docker compose pull
docker compose up -d --remove-orphans
docker logout ghcr.io >/dev/null
docker image prune -f >/dev/null

port=$(grep -E '^HOST_PORT=' .env | tail -n1 | cut -d= -f2)
port=${port:-80}
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${port}/api/status" >/dev/null 2>&1; then
    echo "IPTV Plus is up on port ${port} ($IMAGE)"
    exit 0
  fi
  sleep 3
done
docker compose logs --tail 50
echo "IPTV Plus did not answer on port ${port} within 60s" >&2
exit 1
