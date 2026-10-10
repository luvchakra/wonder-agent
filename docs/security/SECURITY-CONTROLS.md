# WonderID — Payments, Privacy, Financial Compliance & Security Controls

Recorded 2026-10-01. Binding rules are in `CLAUDE.md` §18; this document is
the operator and auditor reference: what each control is, where it lives, and
how to configure and verify it.

## 1. Payments — Stripe and Razorpay (PLATFORM-P1-04, migration 0102)

| Control | Where |
|---|---|
| Hosted payment pages only (PCI DSS SAQ-A) | `modules/billing/service.ts` `startCheckout()` / `openBillingPortal()` |
| Webhook signature verification (HMAC-SHA256, constant time, Stripe 5-min tolerance) | `modules/billing/signatures.ts`, `app/api/v1/billing/webhooks/*` |
| Idempotent intake persisted before processing, redacted payloads; one processor per event (`claimed_at`) | `billing_webhook_events`, `modules/billing/webhooks.ts` |
| No second checkout within 10 minutes of an open one | `startCheckout()` |
| Tenant resolved only from WonderID's own records | `billing_checkouts`, `subscriptions.provider_subscription_id`, `billing_profiles` |
| Stale events never overwrite newer state | `subscriptions.provider_state_at` |
| Immutable issued invoices, accumulate-only refunds | `billing_invoices_guard` trigger |
| Gapless invoice numbers per Indian FY (`WID/2026-27/000001`), drawn only when stored | `next_invoice_number()` via `assign_invoice_number()` (0106) |
| GST (CGST+SGST / IGST / zero-rated export), GSTIN check character | `modules/billing/rules.ts` |
| Maker-checker refunds, plan overrides, immediate cancellation | `billing_adjustments` (+ `four_eyes` check), `/platform-admin/billing` |
| RLS: invoices/profiles readable only with `billing.view` | `has_tenant_permission()` (0101) |

**Setup.**
1. Stripe: set `STRIPE_SECRET_KEY`; create a webhook endpoint at
   `https://<app>/api/v1/billing/webhooks/stripe` with API version
   `2024-06-20` for `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
   `customer.subscription.*`, `invoice.finalized`, `invoice.paid`,
   `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.voided`,
   `invoice.marked_uncollectible`, `charge.refunded`; set its secret as
   `STRIPE_WEBHOOK_SECRET`. Enable the Billing Portal in the Stripe dashboard.
2. Razorpay: set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`; create a webhook at
   `https://<app>/api/v1/billing/webhooks/razorpay` for `subscription.*`,
   `payment.failed`, `refund.created`, `refund.processed`; set
   `RAZORPAY_WEBHOOK_SECRET`. Enable Subscriptions and e-mandates.
3. Set `APP_BASE_URL`, `BILLING_SUPPLIER_GSTIN` (and state code), and adjust
   list prices in `/platform-admin/billing` (changing an amount unlinks the
   provider price; existing subscribers keep theirs).

**Routing.** INR → Razorpay; USD/EUR → Stripe (`chooseProvider()`).
**Plans.** A confirmed payment applies `PLAN_DEFAULTS` limits; a subscription
that ends drops to Free limits; nothing is deleted.

## 2. Privacy — GDPR, UK GDPR, DPDP, CCPA (COMPLIANCE-P0-12, migration 0103)

| Obligation | Control |
|---|---|
| Rights requests answered on time (GDPR Art. 12; DPDP Rule 14; CCPA §1798.130) | `privacy_requests.due_at` from `responseDueAt()`; one lawful extension; daily reminders |
| Identity verified before release/erasure (Art. 12(6)) | `advanceRequest()` refuses until verified |
| Access / portability (Art. 15, 20; DPDP s.11) | `buildSubjectExport()`; `/api/v1/privacy/me/export`; staff export per request |
| Erasure (Art. 17; DPDP s.12) with legal-retention exemption | `eraseSubject()`: four-eyes, membership removed, pseudonymisation, audit trail untouched |
| Consent: specific, versioned, withdrawable (Art. 7; DPDP s.6) | `privacy_consent_purposes`, `privacy_consent_records` (+ immutability trigger) |
| Records of processing (Art. 30), transfers (Art. 44–46) | `privacy_processing_activities` |
| Storage limitation (Art. 5(1)(e); DPDP s.8(7)), legal holds | `privacy_retention_policies`, `privacy_legal_holds`, `/api/cron/privacy` |
| Breach notification (Art. 33–34; DPDP s.8(6), Rule 7) | `privacy_breach_incidents`, `breachObligations()`; close refused while notices outstanding |
| DPO / grievance officer published (Art. 37(7); DPDP s.8(9)) | `privacy_settings`, shown on `/my-privacy` |

WonderID's own cookies are strictly necessary (session, organization,
session clocks, sidebar preference), so no consent banner is required for
them under the ePrivacy rules.

## 3. SOX and financial compliance (FOUNDATION-P0-29, COMPLIANCE-P0-13, migrations 0104–0105)

- **Tamper-evident audit trail.** `audit_logs` and `platform_audit_logs` are
  append-only for every role, including the service role. `audit_logs` rows
  carry `chain_seq`, `prev_hash` and `row_hash`, where `row_hash` is SHA-256
  over the previous hash and the row's content, chained per tenant and
  serialised by an advisory lock. `verify_audit_chain()` reports the first
  break; `/audit/integrity` runs it and audits the run. Retention removes rows
  only through `purge_audit_logs()` (oldest-first, ≥365 days, legal holds
  honoured, checkpoint in `audit_log_purges`). Residual risk: a database
  superuser can disable triggers. That is covered by Supabase access control
  and its own logs, and would still break the chain unless every hash were
  recomputed.
- **Control libraries.** SOX ITGC (APD, PC, CO), SOC 1, PCI DSS v4.0.1, GLBA,
  DORA, RBI ITGRC, SEBI CSCRF, CERT-In, GDPR and DPDP sit alongside the
  existing ISO 27001/42001, NIST CSF/AI RMF, SOC 2 and CIS sets.
- **Segregation of duties in the database.** Access approvals, application
  onboarding, billing adjustments and privacy erasure are all four-eyes.

## 4. IT security baseline (FOUNDATION-P0-30)

- Headers (`next.config.ts`): HSTS (2y, includeSubDomains, preload), COOP
  same-origin, CORP same-origin, CSP with `frame-ancestors 'none'`,
  `frame-src 'none'`, `object-src 'none'` and a `form-action` allow-list
  limited to the payment providers' hosted pages, Permissions-Policy denying
  powerful features, `X-DNS-Prefetch-Control: off`, `poweredByHeader: false`.
- Cross-site write guard on `/api/*` in `proxy.ts` (`lib/security/origin.ts`).
- AES-256-GCM secret encryption with key rotation
  (`SECRET_ENCRYPTION_KEY_PREVIOUS`, `reencryptSecret()`).
- Redaction of secrets, card numbers (Luhn), bank and contact data from stored
  payloads and error text (`lib/security/redact.ts`).
- CI: `.github/workflows/security.yml` runs typecheck, lint, unit tests,
  `npm audit --omit=dev --audit-level=high` and a committed-secret scan.
- `/.well-known/security.txt` (RFC 9116) for vulnerability reports. Replace
  the placeholder contact before production.
- **Won't do (owner decision, 2026-10-10):** Supabase Auth leaked-password
  protection stays off; the advisor warning is accepted.
- **Owner action required.** Set a real `security.txt` contact.
