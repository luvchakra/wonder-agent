#!/usr/bin/env bash
# Deletes every container, volume and generated secret, then rebuilds the
# company from seed. The internal CA and .env are kept unless --all is given.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --profile tools down -v --remove-orphans
rm -rf generated
if [ "${1:-}" = "--all" ]; then rm -rf certs .env; fi
exec ./scripts/up.sh
