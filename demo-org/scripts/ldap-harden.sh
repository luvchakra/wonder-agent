#!/usr/bin/env bash
# The Planet Express LDAP image ships with a published admin password and an
# ACL that lets anyone read the directory. Before it faces the internet:
# a generated admin password, and reads only for authenticated binds.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
hash=$(docker compose exec -T openldap slappasswd -s "$LDAP_ADMIN_PASSWORD")
docker compose exec -T -u root openldap ldapmodify -Q -Y EXTERNAL -H ldapi:/// >/dev/null <<LDIF
dn: olcDatabase={1}hdb,cn=config
changetype: modify
replace: olcRootPW
olcRootPW: ${hash}
-
replace: olcAccess
olcAccess: {0}to attrs=userPassword by self write by anonymous auth by * none
olcAccess: {1}to attrs=shadowLastChange by self write by users read by * none
olcAccess: {2}to * by users read by * none
LDIF
echo "  LDAP admin password set and anonymous reads closed"
# The image also stores the published password on a cn=admin entry in the
# tree, which a bind accepts too: replace it.
docker compose exec -T openldap ldappasswd -x -H ldap://127.0.0.1:10389 -D cn=admin,dc=planetexpress,dc=com -w "$LDAP_ADMIN_PASSWORD" -s "$LDAP_ADMIN_PASSWORD" cn=admin,dc=planetexpress,dc=com
echo "  LDAP admin entry password replaced"
