#!/usr/bin/env bash
# Initialises OpenBao once (one unseal key, kept on this machine only: it is
# a demo) and unseals it after every restart.
set -euo pipefail
cd "$(dirname "$0")/.."
bao() { docker compose exec -T openbao bao "$@" -address=http://127.0.0.1:8200; }
if [ ! -f generated/bao-init.json ]; then
  umask 077
  docker compose exec -T openbao bao operator init -address=http://127.0.0.1:8200 -key-shares=1 -key-threshold=1 -format=json > generated/bao-init.json
  echo "  OpenBao initialised"
fi
key=$(python3 -c 'import json;print(json.load(open("generated/bao-init.json"))["unseal_keys_b64"][0])')
docker compose exec -T openbao bao operator unseal -address=http://127.0.0.1:8200 "$key" >/dev/null
echo "  OpenBao unsealed"
