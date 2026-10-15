# Security test matrix

Which automated tests cover each category of the specification's security
test taxonomy (37A.34) and matrix (S15). Kept by the QA Agent (QA-P0-21).
Last reviewed: 15 October 2026.

Unit and architecture tests run in CI on every pull request. E2E specs run
in the nightly suite. SQL isolation files are run against the database when
their migration is applied.

| Category | Coverage | Main tests |
|---|---|---|
| Authentication | Strong | `tests/architecture/route-gates.test.ts` (every customer route checks a permission, public routes authenticate themselves, cron routes check the secret, vendor routes need a platform administrator); `requirePermission.test.ts`; 401 cases in `scim-receiver`, `mcp-bridge`, `automation-credentials` |
| Authorization (role) | Strong | `authorizeCore.test.ts`; `auth.spec.ts`; `users.spec.ts`; a read-only case in most E2E specs |
| Object scope | Medium | `authorization.spec.ts` (environment scope); `approval-links-drafts.spec.ts`; `tests/qa/same-tenant-references.sql` |
| Tenant isolation | Strong | about 60 `*-isolation.sql` files; `tenant-rls.test.ts` (RLS on every tenant table); `multi-org-isolation.spec.ts`; `live-client-tenant-isolation.mjs` |
| ID tampering | Medium | `multi-org-isolation.spec.ts` "a Tenant One id in the request body is ignored" (new); `receive.test.ts` (a body never chooses the organization); `record-provenance.sql` |
| Input validation | Strong | `validate.test.ts`; `receive.test.ts`; `connectorWriteRules.test.ts`; `file-import.spec.ts` |
| Injection | Medium | `tests/architecture/postgrest-filters.test.ts` (new: every `or()` filter takes only server values or a cleaned search term); `events.test.ts` `decodeCursor` (new); LDAP and DN escaping in `ldapWrite.test.ts` |
| SSRF | Strong | `outboundPolicy.test.ts`; `outboundFetch.test.ts`; `gateway.test.ts`; `outbound-guard.spec.ts` |
| CSRF | Strong | `origin.test.ts`; `csrf.spec.ts`; `trust-compliance.spec.ts` |
| Session | Strong | `sessionSecurity.test.ts`; `users.spec.ts` (suspension ends sessions); `mfa-required.spec.ts` |
| Rate limits | Strong | `rateLimiter.test.ts`; `auth.spec.ts`; `automationCredentialRules.test.ts` |
| Privacy | Strong | `modules/privacy/*.test.ts`; `trust-compliance.spec.ts`; `billing-privacy-tenant-isolation.sql` |
| Audit | Medium | `audit-trail-integrity.sql` (append-only, chain, purge); `changes.test.ts`; per-feature audit checks in E2E specs |
| Provenance | Strong | `record-provenance.sql`; `tables.test.ts`; `RecordProvenance.test.tsx` |
| Replay and idempotency | Strong | `mcp-bridge.spec.ts` (a duplicate is recorded once; old and future-dated events are quarantined, new); `events.test.ts`; `signatures.test.ts` (Stripe tolerance); `connector-provisioning.spec.ts` |
| AI security | Medium | `summarize.test.ts` "keeps injected instructions in the data…" (new); `onboardingProposals.test.ts`; `onboardingProposalRules.test.ts`; `onboarding-proposals.spec.ts` |
| Connector security | Strong | `connector-boundary.test.ts`; `receiveGateway.test.ts`; `connectorWriteRules.test.ts`; `connector-write-operations-checks.sql` |
| Files and oversized payloads | Medium | `csv.test.ts`; `importCsv.test.ts`; `validate.test.ts` (byte limit); `receive.test.ts` (oversized batch) |
| Secrets | Strong | `encryptSecret.test.ts`; `redact.test.ts`; `maskSecret.test.ts`; `agent-api-keys.spec.ts`; `connector-boundary.test.ts` |
| Privilege escalation | Strong | `userRules.test.ts`; `automationCredentialRules.test.ts`; `groups.spec.ts`; `delegatedRoleRules.test.ts` |
| Retention | Medium | `audit-trail-integrity.sql`; `modules/privacy/rules.test.ts`; `connectorScheduleRules.test.ts` |
| Migrations | Medium | `tenant-rls.test.ts`; the SQL test of each migration |
| Performance (authorization engine) | Strong | `authorizeCore.test.ts` "performance budget" (new): one decision under 1 ms, every tenant-wide permission of 40 roles under 50 ms (measured 0.05 ms and 4 ms) |

## Known gaps

- No generic check that every security-sensitive mutation writes an audit
  event. Audit is tested feature by feature.
- Razorpay signatures carry no timestamp, so they have no tolerance window.
  Replays are absorbed by the unique provider event id
  (`billing_webhook_events`), which has no test of its own.
- No E2E sends an oversized body to the server-side import route. The size
  check is unit-tested.
- The performance test measures the engine. The membership and role lookups
  before it are database reads, once per request.
