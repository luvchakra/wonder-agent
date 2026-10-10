# Demo organisation integration plan: Planet Express

**Status:** design, 2026-10-10. Nothing here is built yet.
**Scope:** a self-hosted, open-source company that WonderID governs end to end:
its people, partners, service accounts, tokens, workloads and AI agents, and
all of their access.

This plan describes the **target** integrations. It deliberately ignores what
WonderID's connectors can do today (user request). A gap analysis against the
current connectors is a separate, later step (§10).

---

## 1. Goals

1. **Real, not mocked.** WonderID reads every identity and grant from a running
   system, the way it would at a customer. Nothing is typed into WonderID by
   hand (CLAUDE.md §19.2).
2. **Every identity type.** It covers:
   - employees, contractors and external partners;
   - service accounts, API keys and tokens;
   - workloads and CI jobs;
   - AI agents.
3. **Problems worth finding.** The company ships with planted, known issues (§8),
   so every WonderID feature has something true to detect, review or fix.
4. **Repeatable.** One command rebuilds the company from seed, including its
   problems, so demos and tests start from a known state.
5. **Safe.** The company holds no real personal data or secrets. WonderID
   connects with least-privilege accounts, read-only until write-back is
   deliberately turned on (§9).

---

## 2. The company

**Planet Express, Inc.** is an interplanetary delivery company. Its seven
founding staff come from the open-source `docker-test-openldap` directory (§3).
Generated staff around them bring it to a realistic size.

| | Count | Notes |
|---|---|---|
| Employees | ~230 | 8 departments, 4 levels of management, 3 locations |
| Contractors | ~20 | Fixed end dates, sponsored by an employee |
| External partners | ~10 | Auditors (Hale & Partners), ERP consultants, a logistics partner |
| Service accounts | ~40 | Databases, integrations, batch jobs |
| API keys and tokens | ~60 | Personal access tokens, bot tokens, storage keys, CI tokens |
| Workloads | ~25 | Kubernetes service accounts, CI runners |
| AI agents | 5 | Each with an owner, a purpose and tool access (§7) |

**Departments:** Executive, Finance, People (HR), Delivery Operations,
Engineering, IT & Security, Customer Support, Sales.

**Founders as executives:**
- Hubert Farnsworth, CEO;
- Hermes Conrad, CFO;
- Turanga Leela, VP Delivery Operations;
- Amy Wong, VP Engineering;
- John Zoidberg, Head of People;
- Philip Fry and Bender stay in Delivery Operations.

---

## 3. System landscape

All components are open source and run in one Docker Compose stack, with
Kubernetes (k3s) for workloads.

| Layer | System | Licence | Role at Planet Express | Identities and access it holds |
|---|---|---|---|---|
| HR (system of record) | **Frappe HR** | GPL-3.0 | Employees, contractors, managers, departments, start and end dates | People; manager chain; employment status |
| Legacy directory | **OpenLDAP**, Planet Express image ([repo](https://github.com/rroemhild/docker-test-openldap), MIT) | MIT | The original company directory, kept for an old app | Users, `admin_staff` and `ship_crew` groups |
| Workforce identity provider | **Keycloak** | Apache-2.0 | SSO for every app; groups and roles; federates the legacy LDAP | Accounts, groups, realm and client roles, OAuth clients (machine identities), sessions |
| Finance | **ERPNext**, on the same Frappe site as HR | GPL-3.0 | Purchasing, payables, invoicing | App users and roles (e.g. Accounts User, Purchase Manager); segregation-of-duties conflicts |
| Source code and CI | **Gitea** with Gitea Actions and `act_runner` | MIT | Code, reviews, deployments | Users, organisations, teams, repo permissions, personal access tokens, deploy keys, runner tokens |
| Chat | **Mattermost** Team Edition | Open source | Company chat | Users, teams, channels, bot accounts, webhooks |
| Files | **Nextcloud** | AGPL-3.0 | Shared documents, including finance and HR folders | Users, groups, shares (public links included), app passwords |
| Object storage | **SeaweedFS**, S3 API (not MinIO: its community edition was archived in 2025) | Apache-2.0 | Delivery manifests, backups | Access keys, bucket policies |
| Database | **PostgreSQL** | PostgreSQL | Delivery and customer databases | Roles, logins, grants per schema and table |
| Secrets | **OpenBao** (the open-source fork of Vault) | MPL-2.0 | Holds every machine credential | Secret metadata, owners, last rotation (never the values) |
| Workloads | **k3s** | Apache-2.0 | Runs the delivery services | Service accounts, RBAC roles and bindings, mounted secrets |
| AI agents | MCP reference servers plus an open-source agent framework | MIT / Apache-2.0 | Five business agents (§7) | Agent identities, tool grants, runtime activity |
| Logs | Each system's audit and access logs, gathered by one collector (e.g. Vector, Apache-2.0) | — | Activity evidence | Sign-ins, token use, tool calls |

Customer-facing systems are out of scope: only the workforce and machine side
is governed.

---

## 4. Identity model and sources of truth

WonderID never decides who someone is by itself. Each attribute has one owning
system (CLAUDE.md non-negotiable #7). WonderID records provenance and reconciles
against it.

| Attribute | Authoritative source | Fallback |
|---|---|---|
| Person exists, status, start and end dates | Frappe HR | — |
| Name, title, department, location, manager | Frappe HR | Keycloak for externals |
| Employment type (employee, contractor) | Frappe HR | — |
| External partners and their sponsor | Keycloak `partners` group plus a sponsor attribute | — |
| Sign-in account, MFA, last sign-in | Keycloak | App logs |
| App accounts and entitlements | Each app | — |
| Machine identity owner | OpenBao metadata (`owner`, `purpose`) and k8s annotations | The creator recorded by the app |
| Agent purpose, owner, approved tools | WonderID agent contract | — |

**Correlation keys** (how one person's accounts are tied together), in order:
1. The HR employee ID, carried into Keycloak as `employeeId` and into apps
   through SSO.
2. Work email.
3. Username.

Anything that matches only weakly goes to WonderID's review queue, never an
automatic link (CLAUDE.md §17.6).

**Machine identity ownership:** every service account, token and workload
carries `owner` (an employee ID) and `purpose` labels where it lives. Missing or
departed owners are planted on purpose (§8).

---

## 5. Integration plan per system

For each system: what WonderID reads, how, how often, and what it may change
later.

| System | WonderID reads | Method | Cadence | Events | Write-back (later, with approval) |
|---|---|---|---|---|---|
| Frappe HR | Employees, contractors, managers, departments, dates, status | REST (`/api/resource/Employee`) | Hourly full; webhooks for changes | Joiner, mover, leaver webhooks | None: HR stays the system of record |
| OpenLDAP | Users, groups, members | LDAP read (bind as a read-only account) | Daily | — | Disable the account on leave |
| Keycloak | Users, groups, roles, role mappings, clients (machine identities), sessions | Admin REST API with a client-credentials service account; SCIM where enabled (preview in 26.7) | Hourly; admin events stream | Admin and login events | Disable user, remove from group or role, revoke sessions |
| ERPNext | App users, roles per user, role profiles | REST (`/api/resource/User`, `Has Role`) | Hourly | Document audit trail | Remove role, disable user |
| Gitea | Users, orgs, teams, repo collaborators, tokens (metadata), deploy keys, runners | REST API (admin token) | Hourly | Webhooks; audit logs | Remove from team, revoke token, delete deploy key |
| Mattermost | Users, teams, channel admins, bots, webhooks | REST API | Hourly | Audit log | Deactivate user, disable bot |
| Nextcloud | Users, groups, shares (public links), app passwords | OCS and provisioning API | Daily | Admin audit log | Remove share, remove from group |
| SeaweedFS | Access keys, bucket policies | S3 admin and IAM API | Daily | Access log | Disable key |
| PostgreSQL | Roles, logins, memberships, grants | SQL catalog read (`pg_roles`, `pg_auth_members`, `information_schema` grants) | Daily | `pgaudit` log | Revoke grant, disable login |
| OpenBao | Secret paths, metadata (owner, purpose, created, last rotated), policies, auth roles | API with a metadata-only policy | Daily | Audit device | Flag only: rotation stays with the owner |
| k3s | Service accounts, Roles and ClusterRoles, bindings, secrets references | Kubernetes API with a read-only ClusterRole | Hourly | API server audit log | Remove binding |
| AI agents | Agent registrations, tool grants, MCP servers and tools | Agent registry plus the MCP servers' tool lists | On change | Runtime events through the WonderID gateway | Block a tool, suspend an agent |
| Log collector | Sign-ins, token use, tool calls, data access | Push to WonderID's event intake | Streaming | — | — |

**Rules for every integration:**
- One least-privilege, read-only credential per system, stored only in
  WonderID's encrypted secret store (§18.5).
- An imported record is tagged with its source and the time it was read.
- A failed sync shows "Unavailable" with the reason, never stale data dressed
  up as current (§17.5).

---

## 6. Non-human identities

| Type | Where it lives | Examples planted at Planet Express | Owner link |
|---|---|---|---|
| Service accounts | PostgreSQL logins, Keycloak service-account clients, ERPNext API users | `svc-delivery-etl`, `svc-invoice-sync`, `erp-integration` | OpenBao `owner` metadata |
| Personal access tokens | Gitea, Mattermost | A deploy script using an engineer's personal token | The token's user |
| Bot accounts | Mattermost | `delivery-status-bot`, `oncall-bot` | Creator plus label |
| Storage access keys | SeaweedFS | `backup-writer`, an old partner upload key | OpenBao metadata |
| Deploy keys and runner tokens | Gitea | Production deploy key, two CI runners | Repo or org admins |
| Workloads | k3s service accounts | `route-planner`, `manifest-api`, one with `cluster-admin` | Namespace annotation |
| OAuth clients | Keycloak | The finance agent's client, a partner integration | Client attribute |

Each one carries owner, purpose, created and last-used where the system records
them. Where it doesn't, the collector's logs supply last use.

---

## 7. AI agents

Five agents, each a real process with a Keycloak client identity. They reach
their tools through MCP servers, behind WonderID's runtime gateway, so every
tool call is observed.

| Agent | Owner | Purpose (SHOULD) | Tools granted (CAN) | Planted problem (DID) |
|---|---|---|---|---|
| **FinanceBot** | Hermes Conrad | Month-end reporting | ERPNext read, finance Nextcloud folder | Also granted the customer database; reads customer PII |
| **Dispatch Assistant** | Turanga Leela | Plan deliveries | Delivery database read, route-planner API | — (the control case) |
| **Code Reviewer** | Amy Wong | Review pull requests | Gitea read, comment | Holds a token with repo-admin rights |
| **People Helper** | John Zoidberg | Answer HR policy questions | HR policy documents | Owner leaves the company (§8) |
| **Shadow summariser** | none | none (unregistered) | An engineer's personal Gitea token | Never registered: discovered only from its traffic |

MCP servers: the official reference servers (filesystem, git, fetch), plus small
purpose-built servers for ERPNext and PostgreSQL. The agent framework is any
open-source one; the choice doesn't affect WonderID.

---

## 8. Seed data and planted scenarios

A seed script, idempotent with a fixed random seed, builds the company in this
order:
1. HR records;
2. Keycloak accounts through HR provisioning;
3. app accounts on first SSO sign-in, or via the API for legacy apps;
4. machine identities;
5. agents;
6. a week of generated activity.

It then plants the cases below. Each is a known answer that a WonderID feature
must find.

| # | Scenario | Planted in | WonderID should |
|---|---|---|---|
| 1 | Leaver still active: left 30 days ago in HR, still enabled in Keycloak, Gitea and Nextcloud | HR, Keycloak, apps | Flag the leaver; propose disabling everywhere |
| 2 | Orphaned account: ERPNext and PostgreSQL logins with no person | ERPNext, PostgreSQL | List as orphaned; ask for an owner or removal |
| 3 | Duplicate identity: the same person twice in Keycloak (old and new email) | Keycloak | Send to the correlation review queue |
| 4 | Mover keeps old access: moved from Finance to Sales, still has Purchase Manager | HR, ERPNext | Flag access the new role shouldn't have |
| 5 | Segregation of duties: one person creates suppliers and approves payments | ERPNext | Raise an SoD violation |
| 6 | Contractor overreach: contractor in the `prod-admins` group, contract ended last week | HR, Keycloak, k3s | Flag expired and excessive access |
| 7 | Dormant privileged account: database superuser unused for 120 days | PostgreSQL, logs | Flag dormant privilege |
| 8 | Public share of finance data: a public link on the payroll folder | Nextcloud | Flag the risky share |
| 9 | Machine identity with a departed owner | OpenBao metadata, HR | Reassign the owner; open a review |
| 10 | Token never rotated: storage key 400 days old | SeaweedFS, OpenBao | Flag rotation overdue |
| 11 | Workload with `cluster-admin` | k3s | Flag excessive workload privilege |
| 12 | Personal token used by automation | Gitea, logs | Flag a human credential used as a machine one |
| 13 | Agent exceeds its purpose (FinanceBot reads customer PII) | ERPNext, PostgreSQL, gateway | CRITICAL finding: SHOULD vs CAN vs DID |
| 14 | Unregistered agent | Gateway traffic | Shadow AI discovery |
| 15 | Agent owner leaves (People Helper) | HR | Ownership review for the agent |
| 16 | Partner access past its end date | Keycloak `partners` | Flag for removal at the end date |

Generated people come from a fake-data library (e.g. Faker, MIT). Names, emails
and phone numbers are fictional. Every domain is `planetexpress.example`, a
reserved domain that can never reach a real inbox.

---

## 9. Environment and safety

- **Hosting.** WonderID runs on Vercel and only reaches public HTTPS endpoints.
  The company therefore runs on one small cloud VM (8 vCPU, 16 GB is enough).
  Each system's API is published behind a reverse proxy with TLS, on hostnames
  like `kc.demo.wonderapps.biz`. Admin UIs sit behind an IP allow-list, and only
  the APIs WonderID reads are exposed.
- **Credentials.**
  - Each system gets a dedicated `wonderid-reader` account, read-only, created
    by the seed script.
  - Write-back accounts are created separately and switched on per system only
    in phase 6.
  - No credential is committed. The seed script reads them from the VM's
    environment.
- **Reset.** `make reset` drops every volume and rebuilds from seed in under
  15 minutes. The demo organisation in WonderID is wiped the same way.
- **Data.** Fictional only (§8). Nothing from a real person or company is
  imported.

---

## 10. Phases

| Phase | Delivers | Exit criteria |
|---|---|---|
| 0 Environment | VM, Compose stack, TLS proxy, seed script for HR and Keycloak | Company rebuilds from one command |
| 1 People | HR → WonderID as the authoritative source; Keycloak and LDAP accounts correlated | ~260 people, managers correct, scenarios 1, 3, 16 found |
| 2 Applications | ERPNext, Gitea, Mattermost, Nextcloud, PostgreSQL accounts and entitlements | Scenarios 2, 4, 5, 6, 7, 8 found |
| 3 Machine identities | OpenBao metadata, storage keys, tokens, k3s | Scenarios 9–12 found; every NHI has an owner or is flagged |
| 4 AI agents | Five agents running through the gateway; MCP servers inventoried | Scenarios 13–15 found; SHOULD/CAN/DID shown for FinanceBot |
| 5 Governance | Access reviews, certifications, access requests run against this company | One full certification campaign completed with evidence |
| 6 Write-back | Approved remediation through each system's write API | Leaver from scenario 1 disabled everywhere after approval; re-sync confirms |

**After phase 0:** compare each row of §5 with what WonderID's connectors support
today, and turn the gaps into Integration Agent stories. Known gaps from the
2026-10-10 research:
- no LDAP reader;
- no OAuth token refresh in the REST connector;
- the MCP connector doesn't keep the MCP session ID or read streamed replies;
- REST paging counts pages, not item offsets.

---

## 11. Open decisions

1. **Hosting budget.** One VM, about the price of a small instance, versus a
   local-only demo with a tunnel.
2. **Write-back.** Which systems get write access, and when (phase 6 proposes
   Keycloak, Gitea and ERPNext first).
3. **Activity volume.** How much generated sign-in and tool-call history to
   keep. A week is the default.
4. **Keycloak SCIM.** It is a preview feature in Keycloak 26.7 ([release
   notes](https://www.keycloak.org/2026/07/keycloak-2670-released.html)). Use
   it, or stay on the admin REST API.

## Sources

- [rroemhild/docker-test-openldap](https://github.com/rroemhild/docker-test-openldap)
- [Keycloak 26.7.0 release notes (SCIM API preview)](https://www.keycloak.org/2026/07/keycloak-2670-released.html)
- [Keycloak Admin REST API (OpenAPI)](https://www.keycloak.org/docs-api/latest/rest-api/openapi.yaml)
- [MinIO removes management features from the community edition (Blocks & Files)](https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/)
- [MinIO is in maintenance mode: alternatives (Elest.io)](https://blog.elest.io/minio-is-in-maintenance-mode-your-guide-to-s3-compatible-storage-alternatives/)
- [Gitea API usage](https://docs.gitea.com/development/api-usage)
- [ERPNext v15 demo data code](https://github.com/frappe/erpnext/blob/version-15/erpnext/setup/demo.py)
