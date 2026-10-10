#!/usr/bin/env bash
# Runs as root on every boot of the Planet Express VM: installs Docker the
# first time, then brings the company back up (and unseals OpenBao) once the
# kit has been copied to /opt/planet-express. The seed only runs on the first
# build (scripts/up.sh).
set -euo pipefail
if ! command -v docker >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 python3
  systemctl enable --now docker
fi
if [ -f /opt/planet-express/.env ]; then
  cd /opt/planet-express && ./scripts/up.sh >> /var/log/planet-express.log 2>&1
fi
