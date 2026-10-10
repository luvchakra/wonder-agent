# Planet Express: a company for WonderID to govern

A complete, open-source company on one machine. It has 260 people (employees,
contractors, partners), an HR system, an identity provider, a legacy
directory, applications, a database, a secrets manager and a Kubernetes
cluster. Each system holds realistic access, including the problems an
identity governance product exists to find. WonderID connects to each system
with its built-in connectors (`modules/integrations/framework`), the same way
it would at a customer.

The design and the scenarios are in `docs/plan/DEMO-ORG-INTEGRATION-PLAN.md`.

## What runs

| Address | System | Connector | WonderID reads |
|---|---|---|---|
| `hr.<domain>` | Frappe HR | `frappe-hr` | People: the HR system of record |
| `hr.<domain>` | ERPNext | `erpnext` | Users, roles, role assignments (segregation of duties) |
| `sso.<domain>` | Keycloak | `keycloak` | Accounts and service accounts, groups, realm roles |
| `ldaps://ldap.<domain>:636` | OpenLDAP (legacy) | `ldap-directory` | Accounts, groups, members |
| `git.<domain>` | Gitea | `gitea` | Accounts and bots, teams, membership |
| `chat.<domain>` | Mattermost | `mattermost` | Accounts and bots, teams, membership |
| `files.<domain>` | Nextcloud | `nextcloud` | Accounts, groups, membership |
| `postgres://db.<domain>:5432/delivery` | PostgreSQL | `postgresql` | Logins, group roles with their table privileges |
| `vault.<domain>` | OpenBao | `openbao` | AppRoles, userpass logins, policies |
| `k8s.<domain>` | Kubernetes (k3s) | `kubernetes` | Service accounts, Roles and ClusterRoles, bindings |
| `s3.<domain>` | SeaweedFS | none yet | Object storage that the apps use |

Every reader account is read-only and created by the seed. The exception is
Nextcloud, which has no read-only administrator role: its reader is an
administrator, and WonderID gets only a revocable app password.

## Planted findings

These are flags in `seed/company.py`, so every system tells the same story:

- leavers still active in the IdP and apps (and leavers removed properly);
- a duplicate IdP account under an old email address;
- a mover who kept their Finance access;
- a segregation-of-duties conflict: one person can create suppliers and approve payments;
- an expired contractor who still has admin access;
- a partner still active past their end date;
- an AI agent whose owner has left;
- FinanceBot with access beyond its purpose (customer data, payments administration, billing secrets);
- a personal Git token used by automation;
- shared and unowned superuser logins (the database, OpenBao, Kubernetes).

## Run it

### On Google Cloud (free credits)

From Cloud Shell, in a checkout of this repository:

```bash
cd demo-org
DEMO_DOMAIN=demo.example.com ACME_EMAIL=you@example.com ./gcp/create-vm.sh
```

The script creates:

- one `e2-standard-4` VM in `asia-southeast1`;
- a static IP;
- firewall rules (80/443, plus 636 and 5432 for LDAPS and PostgreSQL);
- a schedule that runs the VM from 08:00 to 20:00 IST.

Running 12 hours a day costs about USD 60 a month, so new-account credits
last several months. To run it around the clock, set `STOP_AT=never`.

When it finishes:

1. Add one DNS record: `*.demo.example.com A <the printed IP>`. Caddy obtains
   the certificates once the record resolves.
2. Read the connection details over SSH (the script prints the command).
3. In WonderID, go to **Integrations → Connect a system**, pick each connector
   and paste in its settings and secret.

### On any Linux machine with Docker

```bash
cd demo-org
DEMO_DOMAIN=demo.example.com ACME_EMAIL=you@example.com ./scripts/up.sh
```

For a local try-out without public DNS, use `DEMO_DOMAIN=demo.localhost` and
`CADDY_GLOBAL_OPTIONS=local_certs`, and add the host names to `/etc/hosts`.

## Day to day

| Command | Does |
|---|---|
| `./scripts/up.sh` | Starts everything and unseals OpenBao; seeds only on the first run |
| `./scripts/up.sh --seed` | Runs the seed again (it is idempotent) |
| `docker compose run --rm seed python main.py keycloak gitea` | Seeds only the named systems |
| `./scripts/reset.sh` | Deletes all data and rebuilds the company; `--all` also replaces the passwords and the internal CA |

## Secrets

- `init-env.sh` generates every password into `.env` on the machine itself.
- The internal CA (`certs/`) signs the LDAPS and PostgreSQL certificates.
  Connection details include it as the `caCertificate` setting.
- `generated/` holds the OpenBao unseal key, the reader tokens and
  `wonderid-connections.{json,md}`, all mode 600.
- `.env`, `certs/` and `generated/` are git-ignored. Never commit or share
  them. If one leaks, run `./scripts/reset.sh --all`.

## Checking the connectors against it

The connector contract test runs every built-in connector against this
company through WonderID's production engine and outbound guard:

```bash
CONNECTOR_LIVE_FILE=demo-org/generated/wonderid-connections.json \
  npx vitest run modules/integrations/framework/live.test.ts
```

With `demo.localhost`, also set `NODE_EXTRA_CA_CERTS` to Caddy's local root
and `OUTBOUND_ALLOW_PRIVATE_NETWORKS=true`. That flag is for local tests only
and must never be set in production.
