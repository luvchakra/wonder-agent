#!/usr/bin/env bash
# Builds Planet Express from nothing: secrets, containers, then the seed.
# Re-running it is safe; the seed only adds what is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/init-env.sh
set -a; . ./.env; set +a

echo "Starting the company's systems (first start pulls images and takes a few minutes)…"
# Kubernetes first: Caddy trusts the cluster's CA, which k3s writes into its kubeconfig.
docker compose up -d k3s
for _ in $(seq 1 60); do [ -s generated/kube/kubeconfig.yaml ] && break; sleep 5; done
grep certificate-authority-data generated/kube/kubeconfig.yaml | awk '{print $2}' | base64 -d > generated/kube/k3s-ca.crt
docker compose up -d

# Every check runs from the Caddy container (some images have no shell).
wait_for() { # label, url, expected text
  for _ in $(seq 1 120); do
    if docker compose exec -T caddy wget -qO- -T 5 "$2" 2>/dev/null | grep -q "$3"; then echo "  $1 ready"; return 0; fi
    sleep 5
  done
  echo "  $1 did not become ready"; return 1
}
wait_for "Keycloak" http://keycloak:8080/realms/master '"realm"'
wait_for "Gitea" http://gitea:3000/api/healthz pass
wait_for "Mattermost" http://mattermost:8065/api/v4/system/ping OK
wait_for "Nextcloud" http://nextcloud/status.php '"installed":true'
wait_for "Frappe HR" http://frappe-frontend:8080/api/method/ping pong
wait_for "OpenBao" "http://openbao:8200/v1/sys/health?uninitcode=200&sealedcode=200" '"initialized"'

./scripts/bao-init.sh
./scripts/ldap-harden.sh
./scripts/app-admins.sh
# The seed runs once; a reboot only restarts and unseals. ./scripts/up.sh --seed re-runs it.
if [ ! -f generated/.seeded ] || [ "${1:-}" = "--seed" ]; then
  docker compose run --rm seed
  touch generated/.seeded
fi
echo
echo "Planet Express is up. Connection details for WonderID: generated/wonderid-connections.md"
