#!/usr/bin/env bash
# Creates .env (random passwords), the company's internal CA with the LDAP
# and database certificates, and the S3 identities file. Safe to re-run:
# nothing that exists is overwritten.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${DEMO_DOMAIN:-demo.localhost}"
rand() { openssl rand -base64 33 | tr -dc 'A-Za-z0-9' | head -c "${1:-28}"; }

if [ ! -f .env ]; then
  umask 077
  cat > .env <<ENV
# Generated $(date -u +%FT%TZ). Never commit this file.
DEMO_DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL:-admin@${DOMAIN}}
CADDY_GLOBAL_OPTIONS=${CADDY_GLOBAL_OPTIONS:-}
APPDB_PASSWORD=$(rand)
CORPDB_PASSWORD=$(rand)
MARIADB_ROOT_PASSWORD=$(rand)
FRAPPE_ADMIN_PASSWORD=$(rand)
KEYCLOAK_ADMIN_PASSWORD=$(rand)
GITEA_ADMIN_PASSWORD=$(rand)
MATTERMOST_ADMIN_PASSWORD=$(rand)
NEXTCLOUD_ADMIN_PASSWORD=$(rand)
LDAP_ADMIN_PASSWORD=$(rand)
LDAP_READER_PASSWORD=$(rand)
CORPDB_READER_PASSWORD=$(rand)
S3_ADMIN_ACCESS_KEY=$(rand 20)
S3_ADMIN_SECRET_KEY=$(rand 40)
SEED=42
ENV
  echo "Created .env for ${DOMAIN}"
fi
set -a; . ./.env; set +a

mkdir -p certs generated/kube
if [ ! -f certs/ca.crt ]; then
  umask 077
  openssl req -x509 -newkey rsa:3072 -nodes -days 825 -subj "/O=Planet Express/CN=Planet Express Internal CA" \
    -keyout certs/ca.key -out certs/ca.crt 2>/dev/null
  for name in ldap db; do
    openssl req -newkey rsa:2048 -nodes -subj "/O=Planet Express/CN=${name}.${DEMO_DOMAIN}" \
      -keyout "certs/${name}.key" -out "certs/${name}.csr" 2>/dev/null
    printf "subjectAltName=DNS:%s.%s,DNS:%s,DNS:localhost\nextendedKeyUsage=serverAuth\n" "$name" "$DEMO_DOMAIN" "$( [ "$name" = db ] && echo corpdb || echo openldap )" > "certs/${name}.ext"
    openssl x509 -req -in "certs/${name}.csr" -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial -days 825 \
      -extfile "certs/${name}.ext" -out "certs/${name}.crt" 2>/dev/null
    rm -f "certs/${name}.csr" "certs/${name}.ext"
  done
  chmod 644 certs/*.crt certs/ldap.key certs/db.key
  echo "Created the internal CA and the LDAP and database certificates"
fi

if [ ! -f generated/s3.json ]; then
  umask 077
  cat > generated/s3.json <<JSON
{
  "identities": [
    { "name": "admin", "credentials": [{ "accessKey": "${S3_ADMIN_ACCESS_KEY}", "secretKey": "${S3_ADMIN_SECRET_KEY}" }], "actions": ["Admin", "Read", "Write", "List", "Tagging"] }
  ]
}
JSON
  chmod 644 generated/s3.json
fi
