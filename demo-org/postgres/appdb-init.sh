#!/bin/bash
# One database and owner per application (Keycloak, Gitea, Mattermost, Nextcloud).
set -euo pipefail
for app in keycloak gitea mattermost nextcloud; do
  psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE ${app} LOGIN PASSWORD '${APP_PASSWORD}';
CREATE DATABASE ${app} OWNER ${app};
SQL
done
