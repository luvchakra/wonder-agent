# 01 — Foundation Agent Backlog

**Agent name:** `Foundation Agent`
**Module:** Foundation, Authentication, Tenancy, Security & RBAC
**Branch:** `module/foundation`
**Status:** ACTIVE (this is the only agent started initially)

---

## Progress Tracker

Status values: **Done** (acceptance criteria met and verified), **Partial**
(built but with a known, documented gap), **Deferred** (not started, not
blocking other agents), **Not Started**. Update this table in the same commit
that finishes, defers, or picks back up a story — see `CLAUDE.md` §4. Detail
for every non-"Done" row is in `docs/design/foundation-agent-backlog-audit.md`.

| Story | Title | Status |
|---|---|---|
| FOUNDATION-P0-01.1 | Initialize the Next.js application | Done |
| FOUNDATION-P0-01.2 | Environment variable contract | Done |
| FOUNDATION-P0-01.3 | Supabase client factories | Done |
| FOUNDATION-P0-02.1 | `tenants` and `tenant_settings` | Done |
| FOUNDATION-P0-02.2 | `users` and `tenant_memberships` | Done |
| FOUNDATION-P0-02.3 | Roles, permissions, RBAC join tables | Done |
| FOUNDATION-P0-02.4 | Row Level Security (higher bar) | Done — `current_tenant_ids()` patched 2026-09-14 (migration `0039`) to also check `tenants.status`, closing a gap Platform Agent's tenant-suspension story surfaced; see audit log |
| FOUNDATION-P0-02.5 | `getTenantContext()` helper | Done |
| FOUNDATION-P0-03.1 | Email/password auth | Done |
| FOUNDATION-P0-03.2 | Tenant selection / JIT provisioning | Done |
| FOUNDATION-P0-03.3 | SSO connection foundation (SAML/OIDC) | Partial — 2026-09-14: full CRUD service/API/admin UI, domain-based sign-in routing, auth callback + JIT provisioning, live RLS-verified; real end-to-end IdP handshake still unverified (needs a real IdP + Supabase-project-level SSO provider registration), see audit log |
| FOUNDATION-P0-03.4 | MFA foundation | Partial — 2026-09-14: Supabase Auth TOTP enroll/verify/unenroll wired at `/settings/security`; real enrollment against a physical authenticator app not verified in this sandbox, see audit log |
| FOUNDATION-P0-04.1 | `requirePermission()` | Done |
| FOUNDATION-P0-04.2 | `requirePlatformAdmin()` (higher bar) | Done |
| FOUNDATION-P0-04.3 | Role management UI (minimal) | Done — 2026-09-14: `/settings/roles`, live RLS-verified |
| FOUNDATION-P0-05.1 | `audit_logs` + `writeAudit()` | Done |
| FOUNDATION-P0-05.2 | Secret encryption helper (higher bar) | Done |
| FOUNDATION-P0-05.3 | Baseline HTTP security | Done — 2026-09-14: CSP/security headers in `next.config.ts`; sign-in/sign-up routed through rate-limited server actions (migration `0040`), live-verified |
| FOUNDATION-P0-06.1 | Platform-admin identity | Done |
| FOUNDATION-P0-06.2 | Route/middleware enforcement | Done |
| FOUNDATION-P0-07.1 | Fixtures (higher bar) | Done |
| FOUNDATION-P0-07.2 | Isolation tests — critical acceptance test (higher bar) | Done |
| FOUNDATION-P0-08 | Job Security primitive (tenant-scoped, idempotent background jobs) | Done — 2026-09-14: `lib/jobs/tenantScopedJob.ts` published, unit-tested; not yet adopted by Integration Agent's existing sync-job code (recommended, not done unilaterally — non-negotiable #18), see audit log |
| FOUNDATION-P0-09 | Session Security (idle/absolute expiry, fixation protection) | Done — 2026-09-14: idle/absolute timeout enforced in `proxy.ts`, unit-tested; fixation mitigated by Supabase issuing a fresh session per sign-in |
| FOUNDATION-P0-11 | Input/Output Safety (shared validation/encoding utility) | Done — 2026-09-14: `lib/security/validate.ts` published, unit-tested, adopted by the new SSO route |
| FOUNDATION-P0-12 | Database Migration Discipline (explicit policy) | Done — already followed as informal practice every module this session; now written down explicitly, see Requirements Refresh below |
| FOUNDATION-P0-15 | Tenant Lifecycle (provisioning/active/suspended/closed) | Done — `tenants.status` existed since FOUNDATION-P0-02.1; enforcement gap closed by migration `0039` (2026-09-14) |
| FOUNDATION-P1-05 | CSRF protection verification & hardening for state-changing `/api/v1/*` routes | Not Started — baseline mitigation exists (`sameSite: "lax"` on every WonderAgent-set cookie: `app/auth/callback/route.ts`, `app/actions/auth.ts`, `app/actions/tenant.ts`) but is not yet verified/documented as covering all 50 state-changing routes under `app/api/**`, and Supabase Auth's own session-cookie `SameSite` setting has not been confirmed; see Requirements Refresh (round 2) below |
| FOUNDATION-P0-16 | `lib/ai/` — shared, read-only, advisory-only LLM summarization primitive | Not Started — 2026-09-15, user decided "start now, read-only summaries only"; see Requirements Refresh below |

---

## Dependencies

None. Every other module depends on this one. Nothing in this backlog waits on
another module.

## Owned entities (this agent may create/modify these tables)

`tenants`, `tenant_settings`, `users`, `tenant_memberships`, `roles`, `permissions`,
`role_permissions`, `user_roles`, `sso_connections`, `audit_logs` (schema + write
utility only — see `docs/design/ownership-map.md`).

## Consumed entities

None — Foundation is the dependency floor.

## Published contracts (other modules consume these; never duplicate them)

- `lib/tenant/getTenantContext()` — server-side helper resolving
  `{ tenantId, userId, roles, permissions }` from the authenticated session. This is
  the *only* legitimate source of `tenant_id` anywhere in the app.
- `lib/rbac/requirePermission(permission: string)` — throws/redirects/403s if the
  current session lacks the permission. All other modules' API routes call this.
- `lib/rbac/requirePlatformAdmin()` — separate guard for `/platform-admin` and
  `/api/platform/v1/*`. Returns false for every customer role, no matter what
  permissions it holds.
- `lib/audit/writeAudit(event: AuditEvent)` — the only way any module writes to
  `audit_logs`.
- `lib/security/encryptSecret()` / `decryptSecret()` — generic server-side envelope
  encryption other modules (notably Integration Agent, for `integration_credentials`)
  must use instead of inventing their own.
- `lib/shared/types/foundation.ts` — `TenantContext`, `Role`, `Permission`,
  `AuditEvent`, `ApiError`, `ApiResult<T>` types.
- `lib/db/supabaseServer()` / `lib/db/supabaseBrowser()` — the only sanctioned ways to
  get a Supabase client. No module may construct its own client or read
  `process.env.SUPABASE_SERVICE_ROLE_KEY` directly.

---

## Higher-bar stories (stop and report on ambiguity — do not guess)

FOUNDATION-P0-02.4 (RLS policies), FOUNDATION-P0-03.* (all auth/SSO), FOUNDATION-P0-05.2
(secret encryption), FOUNDATION-P0-06.* (platform-admin boundary), and
FOUNDATION-P0-07.* (tenant isolation tests) are all held to a higher bar. If the exact
behavior isn't nailed down below, stop and ask rather than inventing an approach.

---

## Epic FOUNDATION-P0-01 — Project Scaffold & Environment

### FOUNDATION-P0-01.1 — Initialize the Next.js application

Create a Next.js (App Router) + TypeScript project at the repo root:

- `create-next-app` equivalent structure: `app/`, `next.config.ts`, `tsconfig.json`
  with `strict: true`.
- Tailwind CSS configured (`tailwind.config.ts`, global stylesheet imported from the
  root layout).
- ESLint configured with the Next.js recommended config plus `@typescript-eslint`.
- A minimal accessible component primitive setup: install Radix UI primitives
  (`@radix-ui/react-*`) as the base for buttons/dialogs/dropdowns/tabs used later by
  the Experience Agent — Foundation only needs to prove the toolchain builds; it does
  not need to build a component library.
- Root layout (`app/layout.tsx`) renders a minimal shell (title "WonderAgent", empty
  body) — this is a placeholder the Experience Agent will replace; Foundation must
  not build dashboard UI here.
- `package.json` scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`),
  `test`.

**Acceptance criteria:** `npm run build` succeeds with zero TypeScript/lint errors on
a clean checkout after `npm install`.

**DO NOT IMPLEMENT:** any dashboard, navigation, or customer-facing page content —
that belongs to the Experience Agent (Module 08).

### FOUNDATION-P0-01.2 — Environment variable contract

Create `.env.local.example` (committed) listing every variable name the app needs,
with no real values:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SECRET_ENCRYPTION_KEY=
```

Add `.env.local` (and `.env*.local`) to `.gitignore` if not already present. Add a
short `README.md` section: "Local setup" explaining that real values go in
`.env.local` (never committed) and, for deployment, in Vercel's encrypted project
environment variables.

**Acceptance criteria:** grep of the git history / working tree for the literal
Supabase service-role key or any JWT-shaped secret returns nothing outside
`.env.local` (which is gitignored).

### FOUNDATION-P0-01.3 — Supabase client factories

`lib/db/supabaseBrowser.ts`: exports a function returning a Supabase client
constructed from `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
safe to import from client components.

`lib/db/supabaseServer.ts`: exports two functions:
- `supabaseServer()` — a request-scoped client that forwards the user's session
  (cookies) so RLS applies as that user. Used by almost all server code/API routes.
- `supabaseServiceRole()` — a client constructed from `SUPABASE_SERVICE_ROLE_KEY`,
  usable **only** in trusted server contexts (migrations tooling, background jobs,
  the audit writer). This function must throw if called from any file under a path
  that could be bundled to the client.

**Acceptance criteria:** a test asserts `supabaseServiceRole` is not reachable from
`app/**/page.tsx`/`app/**/client.tsx` client components (a simple static check that
`SUPABASE_SERVICE_ROLE_KEY` never appears in the built client bundle is sufficient —
run `next build` and grep `.next/static` for the key name/value).

---

## Epic FOUNDATION-P0-02 — Tenant & Identity Core Schema

### FOUNDATION-P0-02.1 — `tenants` and `tenant_settings`

Migration `supabase/migrations/0001_foundation_tenants.sql`:

```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended','deprovisioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  default_role text not null default 'READ_ONLY',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

`status` values: `active` (normal), `suspended` (platform-admin action, all API
access denied except read-only billing/status pages), `deprovisioned` (soft-deleted,
retained for audit per non-negotiable #11, no access at all).

### FOUNDATION-P0-02.2 — `users` and `tenant_memberships`

```sql
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','invited','suspended','removed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
```

A `users` row is created via a Supabase Auth trigger (`handle_new_user()` on
`auth.users` insert) so every authenticated identity has a corresponding `users` row
before any tenant membership can reference it.

### FOUNDATION-P0-02.3 — Roles, permissions, RBAC join tables

```sql
create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade, -- null = system role template
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, -- e.g. 'agent.read'
  description text not null
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, role_id)
);
```

Seed exactly these system roles (tenant_id null, is_system true) — one row per name
from the PRD's Customer RBAC list: `TENANT_SUPER_ADMIN`, `IAM_ADMIN`, `IAM_ARCHITECT`,
`SECURITY_ADMIN`, `CERTIFICATION_MANAGER`, `BUSINESS_OWNER`, `TECHNICAL_OWNER`,
`APPLICATION_OWNER`, `AUDITOR`, `REQUESTER`, `READ_ONLY`.

Seed the permission catalog as `<domain>.<action>` strings. P0 catalog (grow this
list as other modules need new permissions — Foundation does not have to pre-guess
every future module's permissions, but must seed at least):

```text
agent.read, agent.create, agent.update, agent.delete, agent.certify
policy.read, policy.create, policy.update, policy.delete
integration.read, integration.create, integration.update, integration.execute
finding.read, finding.assign, finding.remediate
report.read, report.export
tenant.settings, user.manage, role.manage, sso.manage
```

`TENANT_SUPER_ADMIN` gets every permission. Map the rest sensibly by name (e.g.
`AUDITOR` gets only `*.read` + `report.read`/`report.export`; `READ_ONLY` gets only
`*.read`). Record the exact mapping table in the migration as seed `insert`
statements, not application code, so it's reproducible.

When a new tenant is created, the system roles are the ones assigned to its members
(no per-tenant copy is created unless a tenant customizes a role — customization is
P1; P0 only needs the system roles to be usable tenant-wide).

### FOUNDATION-P0-02.4 — Row Level Security (higher bar)

Enable RLS on every table above. Do not derive `tenant_id` from any client-supplied
value (query param, header, request body). Use a `security definer` SQL function that
reads the authenticated user's memberships:

```sql
create or replace function current_tenant_ids()
returns setof uuid
language sql stable security definer
as $$
  select tenant_id from tenant_memberships
  where user_id = auth.uid() and status = 'active';
$$;
```

Example policy shape (apply the equivalent to every tenant-scoped table):

```sql
alter table tenant_memberships enable row level security;

create policy tenant_memberships_select on tenant_memberships
  for select using (tenant_id in (select current_tenant_ids()));
```

`roles`/`permissions` system rows (`tenant_id is null`) must be readable by any
authenticated user (they're catalog data, not tenant-scoped secrets); tenant-specific
rows follow the same `tenant_id in (select current_tenant_ids())` pattern.
`audit_logs` read policy is tenant-scoped the same way; **no** insert policy is
granted to regular authenticated roles — inserts happen only via the
`writeAudit()` service-role path (FOUNDATION-P0-05.1), enforced by the absence of a
client-facing insert policy plus a database-level `revoke insert ... from authenticated`.

Do not implement a client-side "if tenant matches" check anywhere and consider that
sufficient — RLS is the enforcement layer per non-negotiable #1 and #2.

**Acceptance criteria / test cases:**
- As Tenant A's user, a direct Supabase client query for `tenant_memberships`,
  `roles` (tenant rows), `user_roles`, and `audit_logs` returns zero rows belonging
  to Tenant B, even when the row's primary key/id is known and requested explicitly.
- An anonymous (unauthenticated) client gets zero rows from every tenant-scoped
  table.
- Attempting an `insert` into `audit_logs` as an authenticated (non-service-role)
  client is rejected.

### FOUNDATION-P0-02.5 — `getTenantContext()` helper

`lib/tenant/getTenantContext.ts` exports an async function that, given the current
request's Supabase server client, returns:

```ts
type TenantContext = {
  userId: string;
  tenantId: string | null;   // null only when the user has no active membership yet
  tenantSlug: string | null;
  roles: string[];           // role names for this tenant
  permissions: string[];     // resolved permission keys for this tenant
};
```

If a user belongs to multiple tenants, the active tenant is resolved from a signed,
httpOnly session cookie (`wa_tenant`) set at tenant-selection time — never from a URL
param or request body read without cross-checking it against the user's actual
memberships. If the cookie names a tenant the user is no longer a member of, treat it
as absent and require re-selection.

**Worked example:** user `u1` has active memberships in tenant `t1` (role
`IAM_ADMIN`) and tenant `t2` (role `READ_ONLY`). Cookie `wa_tenant=t1`.
`getTenantContext()` returns `{ userId: 'u1', tenantId: 't1', tenantSlug: 'acme',
roles: ['IAM_ADMIN'], permissions: ['agent.read','agent.create', ...] }`. If the
cookie is missing or names `t3` (no membership), `tenantId` is `null` and callers
must redirect to tenant selection.

---

## Epic FOUNDATION-P0-03 — Authentication (higher bar)

### FOUNDATION-P0-03.1 — Email/password auth

Implement sign-up, sign-in, sign-out using Supabase Auth (`supabase.auth.signUp`,
`signInWithPassword`, `signOut`). On first successful sign-up, the `handle_new_user`
trigger (FOUNDATION-P0-02.2) creates the `users` row. No tenant membership is created
automatically — see 03.2.

### FOUNDATION-P0-03.2 — Tenant selection / JIT provisioning

After sign-in, if the user has zero tenant memberships: show a "Create your
organization" flow that creates a `tenants` row, a `tenant_settings` row, and a
`tenant_memberships` row for that user with role `TENANT_SUPER_ADMIN`. If the user
has one or more memberships, show a tenant picker (bare list is fine — Experience
Agent will style it) and set the `wa_tenant` cookie on selection.

**DO NOT IMPLEMENT:** invitations/multi-user tenant onboarding flows beyond creating
the first `TENANT_SUPER_ADMIN` — invite-a-teammate UI can be a fast-follow story but
is not required to satisfy this story's acceptance criteria.

### FOUNDATION-P0-03.3 — SSO connection foundation (SAML/OIDC)

Schema:

```sql
create table sso_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  protocol text not null check (protocol in ('saml','oidc')),
  domain text not null, -- email domain this connection applies to
  idp_metadata jsonb not null, -- entity id, sso url, certificate / oidc issuer+client config
  default_role text not null default 'READ_ONLY',
  claims_mapping jsonb not null default '{}'::jsonb, -- email/role/group claim keys
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  unique (domain)
);
```

Use Supabase Auth's native SSO support (`supabase.auth.signInWithSSO({ domain })`)
against a configured Supabase SSO provider for the tenant's domain; this table stores
WonderAgent's own record of the connection (for the admin UI and claims→role
mapping) alongside whatever Supabase's own SSO provider configuration requires.
**Never trust email domain alone for tenant authorization** — domain only selects
*which* SSO connection to use; tenant membership is still granted explicitly (JIT
provisioning may create the membership automatically only when
`sso_connections.status = 'active'` for that domain, using `claims_mapping` to
resolve the tenant and initial role from the IdP's asserted claims, and the created
membership must record `source = 'sso_jit'` in its audit event).

If, when implementing this, the exact Supabase SSO configuration/API shape needed for
a real IdP handshake is unclear or requires an Enterprise-tier Supabase feature not
available on the connected project — **stop and report** rather than fabricating a
custom SAML implementation from scratch; this is exactly the kind of ambiguity that
must come back to the user.

### FOUNDATION-P0-03.4 — MFA foundation

Enable Supabase Auth's built-in MFA (TOTP) enrollment/challenge flow on the account
settings page (a bare form is fine; Experience Agent restyles later). Do not build a
custom MFA implementation — use Supabase Auth's `mfa.enroll`/`mfa.challenge`/`mfa.verify`.

---

## Epic FOUNDATION-P0-04 — RBAC & Authorization Middleware

### FOUNDATION-P0-04.1 — `requirePermission()`

`lib/rbac/requirePermission.ts`:

```ts
export async function requirePermission(permission: string): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) throw new ApiError(401, 'NO_TENANT');
  if (!ctx.permissions.includes(permission)) throw new ApiError(403, 'FORBIDDEN');
  return ctx;
}
```

Every `/api/v1/*` route handler in every module calls this (or
`requirePlatformAdmin()` for platform routes) as its first line. Document this
requirement here so every other module's backlog can reference it instead of
reinventing an authorization check.

### FOUNDATION-P0-04.2 — `requirePlatformAdmin()` (higher bar — see Epic 06)

### FOUNDATION-P0-04.3 — Role management UI (minimal)

A bare `/settings/roles` page (tenant-scoped, requires `role.manage`) listing users
in the tenant with their assigned role(s) and a way to assign/remove a role.
Functional, not styled — Experience Agent restyles it later; Foundation must not
block on visual polish.

---

## Epic FOUNDATION-P0-05 — Shared Security & Audit Primitives

### FOUNDATION-P0-05.1 — `audit_logs` + `writeAudit()`

```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid, -- references users(id); null for system-initiated actions
  actor_type text not null check (actor_type in ('user','system','integration')),
  action text not null,          -- e.g. 'agent.owner_changed'
  object_type text not null,     -- e.g. 'agent'
  object_id text not null,
  outcome text not null check (outcome in ('success','failure')),
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create index on audit_logs (tenant_id, created_at desc);
```

`lib/audit/writeAudit.ts` exports `writeAudit(event: AuditEvent): Promise<void>`
which uses `supabaseServiceRole()` to insert (bypassing the no-insert-for-authenticated
policy, since only this trusted server function should write here). It never throws
in a way that aborts the caller's primary action — log a server-side error if the
audit write itself fails, but do not silently swallow it either (surface it to
platform health monitoring once Operations/Platform modules exist; for P0, a
`console.error` with enough context is the floor).

**Worked example:** an IAM Admin removes CustomerDB entitlement from FinanceBot (this
call is made from the Access Agent's module, but it calls Foundation's shared
utility):

```ts
await writeAudit({
  tenantId: ctx.tenantId,
  actorId: ctx.userId,
  actorType: 'user',
  action: 'access.entitlement_removed',
  objectType: 'entitlement',
  objectId: entitlementId,
  outcome: 'success',
  metadata: { agentId: 'financebot-id', application: 'snowflake', entitlement: 'CustomerDB' },
  correlationId: findingId,
});
```

### FOUNDATION-P0-05.2 — Secret encryption helper (higher bar)

`lib/security/encryptSecret.ts` / `decryptSecret.ts`. Use `pgsodium`/Postgres
`pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) with a key sourced from
`SECRET_ENCRYPTION_KEY` (server env var, never the Supabase anon/service key itself),
or Supabase Vault if available on the connected project. Function signatures:

```ts
export async function encryptSecret(plaintext: string): Promise<string>; // returns ciphertext
export async function decryptSecret(ciphertext: string): Promise<string>;
```

This exists so the Integration Agent's `integration_credentials` table (and any
future module needing to store a secret) has one sanctioned mechanism instead of
each module inventing its own crypto. If Supabase Vault availability on the connected
project is uncertain, stop and report rather than guessing between Vault and
`pgcrypto` — this is a security-sensitive architecture decision.

### FOUNDATION-P0-05.3 — Baseline HTTP security

Add secure headers (CSP baseline, `X-Content-Type-Options`, `Referrer-Policy`) via
`next.config.ts` headers, and a basic per-IP/per-user rate limiter on
authentication endpoints (sign-in, sign-up) to blunt credential-stuffing — an
in-memory/Supabase-table-backed limiter is sufficient for P0; do not add a new
infrastructure dependency (e.g. Redis) without stopping to ask first, since that
would be a locked-architecture change.

---

## Epic FOUNDATION-P0-06 — Platform Admin Authorization Boundary (higher bar)

### FOUNDATION-P0-06.1 — Platform-admin identity

```sql
create table platform_admins (
  user_id uuid primary key references users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id)
);
```

This table has **no** RLS policy granting access to regular authenticated users at
all (not even to read their own row) — only `supabaseServiceRole()` reads/writes it.
`lib/rbac/requirePlatformAdmin.ts` checks membership in this table via a
service-role-backed server call and returns `false` for anyone not listed, full stop
— no customer role, however privileged (`TENANT_SUPER_ADMIN` included), can ever
satisfy this check.

Seeding the first platform admin is a manual, out-of-band operation (direct SQL
against the dev project by the Foundation Agent, documented in the audit log with the
seeded user's id — never hardcode a specific email/user as an in-app bypass).

### FOUNDATION-P0-06.2 — Route/middleware enforcement

`app/platform-admin/layout.tsx` and every `app/api/platform/v1/**/route.ts` call
`requirePlatformAdmin()` before rendering/executing anything. Add a Next.js
middleware matcher for `/platform-admin/*` and `/api/platform/v1/*` that performs the
same check at the edge as a defense-in-depth measure (not a replacement for the
per-route check).

**Acceptance criteria / test cases:**
- A `TENANT_SUPER_ADMIN` (or any other customer role) hitting
  `/platform-admin` or any `/api/platform/v1/*` route receives a hard 403/redirect —
  never a partial render, never a "you don't have permission" page that still leaks
  navigation into the platform console.
- A platform admin can reach `/platform-admin` and its APIs normally.
- A platform-admin user with **no** tenant membership at all can still authenticate
  and use `/platform-admin` (platform admins are not required to also be a customer
  tenant member).

---

## Epic FOUNDATION-P0-07 — Tenant Isolation Test Suite (higher bar)

### FOUNDATION-P0-07.1 — Fixtures

A test setup script creates Tenant A and Tenant B, one user each with a
`TENANT_SUPER_ADMIN` role, and one representative row in every tenant-scoped table
that exists at the time this story is implemented (initially: `tenant_memberships`,
`user_roles`, `audit_logs`; extend this fixture as other modules add tables — this is
a living script other modules' RLS tests should reuse rather than duplicate).

### FOUNDATION-P0-07.2 — Isolation tests

Automated tests (integration tests hitting a real dev Supabase project, not mocks)
proving:

1. Tenant A's authenticated client cannot `select` any Tenant B row from any
   tenant-scoped table, even by primary key.
2. Tenant A's authenticated client cannot `update`/`delete` any Tenant B row.
3. Tenant A's authenticated client cannot `insert` a row claiming `tenant_id =
   <Tenant B's id>` (RLS `with check` must reject it, not just filter reads).
4. An unauthenticated client gets zero rows everywhere tenant-scoped.
5. `requirePermission()` denies a `READ_ONLY` user attempting `agent.create`.
6. `requirePlatformAdmin()` denies every non-platform-admin fixture user.

This is the "Critical acceptance test" from the module brief — do not consider
Foundation done until this suite exists and passes on a real (not mocked) dev
database connection.

---

## Requirements Refresh — 2026-09-14

The user supplied an updated master requirements package
(`WonderAgent_Updated_Requirements_11_Docs.zip`, module doc
`01_FOUNDATION_SECURITY.md`) that expands this module's P0/P1/P2 scope beyond
what was already tracked above. Reconciled against the existing Progress
Tracker (nothing already `Done` was reopened); the following are genuinely
new or newly-explicit stories added to the tracker:

### FOUNDATION-P0-08 — Job Security primitive

Background/async jobs (consumed today by Integration Agent's sync jobs) must
carry tenant context resolved server-side (never from job payload alone
without verification), use idempotency keys, enforce authorization at job
*creation* time, record status, and be structurally unable to execute across
tenants. Foundation's job is to publish the shared contract/helper (e.g. a
`createTenantScopedJob()` wrapper or documented pattern) other modules'
job-creation code must use, rather than each module inventing its own
tenant-context plumbing for jobs. Integration Agent's existing
`integration_sync_jobs` implementation already does this per-module — this
story is about extracting/documenting the shared pattern so it doesn't drift
per module. **Not started.**

### FOUNDATION-P0-09 — Session Security

Explicit secure cookie/session configuration (idle expiry, absolute expiry,
logout invalidation, session-fixation protection) on top of Supabase Auth's
defaults. Audit exactly what Supabase Auth already provides out of the box
vs. what WonderAgent must configure explicitly (e.g. JWT expiry, refresh
token rotation) and document the gap. **Not started.**

### FOUNDATION-P0-11 — Input/Output Safety

A shared server-side validation/encoding utility other modules' API routes
use at their trust boundary (structured input validation, untrusted-output
encoding, file-upload constraints, import-metadata sanitization, no unsafe
dynamic SQL). Today each module validates its own route inputs ad hoc
(e.g. with hand-rolled checks); this story is to publish one shared
`lib/security/validate.ts`-style contract other modules adopt going forward,
without rewriting already-shipped route handlers unless a real gap is found.
**Not started.**

### FOUNDATION-P0-12 — Database Migration Discipline (made explicit)

Every module this session has already followed additive-only,
forward-applicable migrations with sortable numeric prefixes — this is
existing practice, not a gap. Marked `Done` in the tracker to reflect that
the practice is real and has held for 39 migrations so far, not merely
aspirational.

### FOUNDATION-P0-15 — Tenant Lifecycle (made explicit)

Already satisfied: `tenants.status` (`active`/`suspended`/`deprovisioned`)
has existed since the first schema migration, and the enforcement gap
Platform Agent surfaced (suspended tenants could still read/write data) was
closed in migration `0039` — see this log's 2026-09-14 entry above.

### Already covered, no new tracker row needed

FOUNDATION-P0-01 (Tenant Context), -02 (RLS Coverage), -05 (Secure Secrets),
-06 (Audit Primitive), -13 (Permission Bootstrap), -14 (Platform Boundary)
map directly onto already-`Done` stories above (02.4/02.5, 05.1, 05.2, 02.3,
06.1/06.2 respectively) — no scope change. FOUNDATION-P0-03 (Authorization
Matrix) and -10 (Security Headers) map onto existing `Done`/`Deferred`
stories (04.1/04.2 and 05.3) with no change to their current status.
FOUNDATION-P0-04 (SSO), -07 (rate-limiting portion of API Security) remain
`Deferred` exactly as already tracked (03.3, 05.3) — the new doc does not
change their acceptance criteria in a way that invalidates prior scoping.

**Not a decision made unilaterally:** the new requirements package's
"Modular Execution Guide" (`00_MODULAR_EXECUTION_GUIDE.md`) also states a
different *process* model ("Only the agent explicitly activated by the user
may start work. Agents must never launch another agent automatically") than
this repository's standing autopilot/auto-chain policy in `CLAUDE.md` §7 and
`docs/ORCHESTRATION.md` §2. That is a meta/process question, not a product
requirement, and is called out to the user separately rather than silently
changed here.

## Requirements Refresh — 2026-09-14 (round 2, expanded doc)

The user re-supplied `01_FOUNDATION_SECURITY.md` at a new upload path,
described as a newer/expanded version of the same module doc reconciled in
the round-1 refresh directly above. Full reconciliation performed against:
the round-2 doc's narrative sections (1 Research-Informed Product
Principles, 2 Target Users, 3 Multi-Tenant Architecture, 26 SSO, 27 Customer
RBAC, 39 Recommended Technology Stack, 40 Database Core Model, 41 RLS
Requirements, 42 API Architecture, 43 Integration Job Architecture, 44
Security Requirements, 45 AI/LLM Architecture) and its own "Expanded
Requirements — Foundation P0/P1/P2" section (FOUNDATION-P0-01 through
FOUNDATION-P0-15, FOUNDATION-P1-01 through FOUNDATION-P1-04,
FOUNDATION-P2-01, FOUNDATION-P2-02) plus its "Foundation test matrix" note;
also cross-checked against the live codebase under `lib/security/`,
`lib/tenant/`, `lib/jobs/`, `lib/rbac/`, `lib/audit/`, `lib/auth/`,
`app/api/`, and `supabase/migrations/` rather than trusting the backlog's own
bookkeeping alone.

**Finding:** every numbered `FOUNDATION-P0-*`/`P1-*`/`P2-*` item in the
round-2 doc's "Expanded Requirements" section is identical in substance to
the round-1 doc already reconciled directly above (same 15 P0 items, same 4
P1 items, same 2 P2 items, same acceptance wording) — nothing new there. The
round-2 doc's narrative sections (1, 2, 3, 26, 27, 39–45) are the same
supporting master-PRD text already used to write the existing stories (tenant
hierarchy → FOUNDATION-P0-02.*; SSO claims/domain/JIT shape → FOUNDATION-P0-
03.3; RBAC role/permission catalog → FOUNDATION-P0-02.3, seeded verbatim;
RLS → FOUNDATION-P0-02.4; API route prefixes → `CLAUDE.md` §5 and every
module's `app/api/v1/*`; job-architecture fields (status/records-processed/
records-failed/retry-count/correlation-id) → correctly Integration Agent's
`integration_sync_jobs` schema, not Foundation's, since `lib/jobs/
tenantScopedJob.ts`'s own docblock deliberately leaves per-job status/
progress schema to each owning module; AI/LLM architecture → `CLAUDE.md`
non-negotiable #9 plus Product Boundaries item 10, already binding).

**One genuinely new item found**, not present anywhere in the round-1
refresh or the existing stories: section 44's mandatory Security
Requirements list names **"CSRF protection where relevant"** alongside items
that already have dedicated stories (rate limiting, secure headers — both
FOUNDATION-P0-05.3). No story, audit-log entry, or code comment anywhere in
this module addresses CSRF explicitly, and the app now has 50 state-changing
`POST`/`PUT`/`PATCH`/`DELETE` routes under `app/api/**` authorized via
cookie-forwarded sessions (`supabaseServer()`), which is exactly the shape of
surface CSRF protection applies to. It wasn't caught in round 1 because the
round-1 refresh reconciled only the doc's numbered `FOUNDATION-P0-*` items,
and CSRF appears solely as a bullet inside section 44's prose list, not as
its own numbered story in either round's "Expanded Requirements" section.

Added **FOUNDATION-P1-05 — CSRF protection verification & hardening** to the
Progress Tracker as `Not Started`. Scoped P1 (enterprise readiness), not P0,
because: (a) every cookie WonderAgent itself sets already carries `sameSite:
"lax"` (`app/auth/callback/route.ts`, `app/actions/auth.ts`,
`app/actions/tenant.ts`), which already blocks the classic cross-site
`<form>`-POST CSRF vector for same-site-lax-respecting browsers — this is a
real, if unverified-as-sufficient, existing baseline, not an open door; and
(b) per `CLAUDE.md` §3, ambiguous/undertiered scope defaults to P1/P2 rather
than P0, and the doc itself does not tier this item or give it a distinct
acceptance criterion beyond the one-line mandatory-list mention. The story
still needs real work before `Done`: confirm Supabase Auth's own session
cookie is also `SameSite=Lax` (or add explicit Origin/Referer header
verification for API routes if it is not), and add the isolation-style
positive/negative test this module holds every security story to (a
same-origin mutation succeeds; a forged cross-origin request without the
expected same-site cookie context is rejected).

No other rows were added — everything else in the round-2 doc was already
covered by an existing `Done`/`Partial`/`Deferred` row or by another module's
backlog (`npm audit` + GitHub secret scanning: QA Agent, `QA-P0-12`;
integration-credential rotation: Integration Agent, `INTEGRATION-P0-05.1`;
encryption-key rotation: Platform Agent, `09-PLATFORM-AGENT-BACKLOG.md`).
"Magic link" auth under section 39 is explicitly optional ("if desired") in
the doc and was not added as a story for that reason. No existing `Done` or
`Partial` row's status was changed.

## P1 (do not build ahead of P0)

- Per-tenant custom role creation/editing (beyond assigning existing system roles).
- Invitation emails / multi-step teammate onboarding.
- Delegated administration (temporary elevated access with expiry).
- SCIM provisioning (FOUNDATION-P1-01).
- Step-up authentication for high-impact operations — agent suspension, credential
  rotation, platform changes, bulk remediation (FOUNDATION-P1-02).
- Security event hooks — normalized events for login anomalies, permission changes,
  failed authorization, credential changes, admin mutations (FOUNDATION-P1-03).
- Tenant-configurable data retention for runtime events/audit evidence/exported
  reports, subject to platform minimums (FOUNDATION-P1-04).
- CSRF protection verification & hardening for state-changing `/api/v1/*` routes —
  confirm Supabase Auth's session cookie `SameSite` setting, add explicit
  Origin/Referer verification if needed, and add positive/negative tests
  (FOUNDATION-P1-05).
- Redis-backed or distributed rate limiting.
- Per-tenant custom branding (that's Platform Agent's "Global Branding" for the
  platform level; per-tenant branding is a distinct, later feature).

## P2 (strategic, after P0/P1 proven)

- Adaptive/risk-aware authentication and conditional access signals, without
  changing the core RBAC contract (FOUNDATION-P2-01).
- IP restrictions, device posture signals, privileged admin approval workflows,
  customer-managed encryption options where architecture permits
  (FOUNDATION-P2-02).

## Requirements Refresh — 2026-09-15 (governance requirements doc)

The user supplied a new "Updated P0/P1 Governance Requirements" document
spanning all 11 modules; full mapping is in
`docs/design/governance-requirements-reconciliation-2026-09-15.md`. No new
Foundation-owned story found — Foundation's existing primitives
(`requirePermission()`, `writeAudit()`, `encryptSecret()`/secret handling,
RLS/tenant context) are exactly what every new cross-cutting concept in
that document (Governance Posture, Attestation, Exceptions, Drift,
AI-Assisted Investigation) would build on once ownership is decided —
nothing for Foundation to build itself yet. One forward note: if
AI-Assisted Investigation (open decision, see the reconciliation doc) ever
needs an external LLM provider credential, it would use Foundation's
existing `encryptSecret()` pattern rather than inventing a new one — not a
new story, just a constraint recorded for whichever module picks that up.

### FOUNDATION-P0-16 — `lib/ai/` shared summarization primitive (decision resolved 2026-09-15, later same day)

The user answered via `AskUserQuestion`: **start now, read-only summaries
only** — Experience Agent UI (`EXPERIENCE-P0-14`, that module's own
backlog) plus a new shared `lib/ai/` primitive here, matching how
`lib/audit/writeAudit()` is a Foundation-owned primitive every module
calls. **Hard boundary, enforced in code, not just documented:** the
primitive only ever *summarizes already-computed data* (a finding, an
evidence bundle, a SHOULD/CAN/DID comparison) that the calling module
passes in — it never queries a database itself, never has write access to
anything, and its output is always rendered as advisory text, never as a
value a deterministic decision (authorization, risk score, policy
evaluation, remediation) reads back (non-negotiable #9). Needs an explicit
provider/credential decision (which LLM API, stored via the existing
`encryptSecret()` pattern, server-only, never in client code — non-
negotiable #10) before the first real call; stub/interface can be built
without one. **Not started.**

## DO NOT IMPLEMENT (out of scope for this module, ever)

- Any AI-agent domain concept (`agents`, lifecycle, contracts) — Identity Agent.
- Any connector/integration logic — Integration Agent.
- Any policy *content* (SoD rules, access policies) beyond the RBAC permission
  catalog itself — Access Agent owns `policies`/`policy_rules`.
- Any dashboard/navigation/visual design — Experience Agent.
- Platform-admin *feature* screens (tenant list UI, subscription management UI) —
  Platform Agent owns those; Foundation only owns the authorization boundary they run
  inside.
