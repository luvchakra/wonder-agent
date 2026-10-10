#!/usr/bin/env bash
# Creates the administrator the seed signs in as, in apps that have no
# bootstrap-admin setting (Gitea, Mattermost). Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

if ! docker compose exec -T -u git gitea gitea admin user list --admin 2>/dev/null | grep -q " pe-admin "; then
  docker compose exec -T -u git gitea gitea admin user create --admin --username pe-admin \
    --email "pe-admin@planetexpress.example" --password "$GITEA_ADMIN_PASSWORD" --must-change-password=false >/dev/null
fi
docker compose exec -T -u git gitea gitea admin user change-password --username pe-admin \
  --password "$GITEA_ADMIN_PASSWORD" --must-change-password=false >/dev/null
echo "  Gitea administrator ready"

if ! docker compose exec -T mattermost mmctl --local user search pe-admin >/dev/null 2>&1; then
  docker compose exec -T mattermost mmctl --local user create --username pe-admin \
    --email "pe-admin@planetexpress.example" --password "$MATTERMOST_ADMIN_PASSWORD" --system-admin >/dev/null
fi
docker compose exec -T mattermost mmctl --local user change-password pe-admin --password "$MATTERMOST_ADMIN_PASSWORD" >/dev/null
echo "  Mattermost administrator ready"
