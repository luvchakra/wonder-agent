# WonderID roadmap progress

What WonderID does today and what comes next, phase by phase. Built from the [knowledge base](KNOWLEDGE-BASE.md) and the [phase plan](run-order/RUN-ORDER.md).

✅ done · 🔶 partly done · ⬜ not started · progress counts partly done as half

**Overall: 62%** `██████░░░░`

| # | Phase | Progress |
|---|---|---|
| 1 | [Foundation, sign-in and identity](#1-foundation-sign-in-and-identity) | `█████████░` 88% |
| 2 | [Applications, accounts and connections](#2-applications-accounts-and-connections) | `██████████` 100% |
| 3 | [Access requests](#3-access-requests) | `██████████` 100% |
| 4 | [Provisioning](#4-provisioning) | `██████░░░░` 59% |
| 5 | [AI agents](#5-ai-agents) | `██████████` 100% |
| 6 | [Risk, reviews and compliance](#6-risk-reviews-and-compliance) | `██████████` 100% |
| 7 | [Lifecycle and reviews for everyone](#7-lifecycle-and-reviews-for-everyone) | `████████░░` 85% |
| 8 | [Roles, separation of duties and delegation](#8-roles-separation-of-duties-and-delegation) | `███░░░░░░░` 30% |
| 9 | [Agent ID and trusted credentials](#9-agent-id-and-trusted-credentials) | `░░░░░░░░░░` 0% |
| 10 | [Workflow, forms and configuration](#10-workflow-forms-and-configuration) | `██████░░░░` 57% |
| 11 | [Advanced governance](#11-advanced-governance) | `░░░░░░░░░░` 0% |
| 12 | [Intelligence and experience](#12-intelligence-and-experience) | `█░░░░░░░░░` 6% |
| 13 | [Release readiness](#13-release-readiness) | `██████████` 100% |

## 1. Foundation, sign-in and identity — 88%

- ✅ Organizations, own web addresses and branding
- ✅ Vendor platform console: organizations, plans, flags, billing, health
- ✅ Organization addresses and environments (dev, test, staging)
- ✅ Sign-in: password, Google, Microsoft, LinkedIn
- 🔶 Single sign-on (SAML / OIDC)
- ✅ Two-step verification, and requiring it for everyone
- ✅ Roles, permissions, scoped assignments and policies
- ✅ Users, invitations and groups
- ✅ Automation credentials for the API
- ✅ One directory for every identity type
- ✅ Identity sources and matching
- ✅ Joiner, mover and leaver
- ⬜ Passkeys

## 2. Applications, accounts and connections — 100%

- ✅ Application catalog and onboarding
- ✅ Application discovery
- ✅ Connector framework and gateway
- ✅ Built-in connectors (HR, identity provider, LDAP, applications)
- ✅ CSV import and export
- ✅ Accounts inventory: orphaned, dormant, privileged
- ✅ Reconciliation of accounts, entitlements and grants
- ✅ Non-human identities from accounts
- ✅ Custom attributes
- ✅ Connection security: allowed hosts, threat model

## 3. Access requests — 100%

- ✅ Request catalog and request policies
- ✅ Approval engine
- ✅ Access packages and birthright access
- ✅ Time-bound access and extensions
- ✅ Remove-access and account requests
- ✅ Requests for service accounts and AI agents
- ✅ Request tracking and one inbox

## 4. Provisioning — 59%

- ✅ Connectors remove access and disable accounts
- ✅ Connectors grant access and create accounts
- ✅ Safety guard on automatic changes
- ✅ Richer connection types (transforms, OAuth, certificates)
- ✅ Rogue access removed through connectors
- 🔶 SCIM, LDAP and HTTP writes
- ⬜ Relay into private networks
- ⬜ Microsoft Entra ID connector
- ⬜ HR system connector
- ✅ Internal fulfilment task assignment
- ⬜ ServiceNow ticketing

## 5. AI agents — 100%

- ✅ Agent registry, owners and lifecycle
- ✅ Agent discovery and shadow AI
- ✅ Runtime gateway and emergency stop
- ✅ Approved vs possible vs actual use (SHOULD / CAN / DID)
- ✅ Rogue agent detection
- ✅ MCP servers inventory
- ✅ Agent API keys

## 6. Risk, reviews and compliance — 100%

- ✅ Risk scoring and findings
- ✅ Investigations
- ✅ Rogue accounts
- ✅ Access review campaigns
- ✅ Separation of duties (process)
- ✅ Control frameworks and evidence
- ✅ Privacy (GDPR, DPDP)
- ✅ Tamper-evident audit trail
- ✅ Ready-made reports and exports
- ✅ Billing (Stripe, Razorpay)

## 7. Lifecycle and reviews for everyone — 85%

- ✅ Shared rule engine
- ✅ Attribute rules
- ✅ Lifecycle rules
- ✅ Identity detail pages
- ✅ Entitlement types and classification
- 🔶 Reviews for every identity type
- ✅ Reviews of administrators
- ✅ Review templates and SLA reporting
- ✅ Merging duplicate people
- ⬜ Field-level audit detail

## 8. Roles, separation of duties and delegation — 30%

- ⬜ Business and IT roles
- ⬜ Access-combination SoD
- 🔶 Delegations
- ✅ Approved changes to governance objects
- ⬜ SoD violation workflow

## 9. Agent ID and trusted credentials — 0%

- ⬜ Agent onboarding with sponsors
- ⬜ Discovery rules and templates
- ⬜ Agent identifiers and credential bindings
- ⬜ Token service and AuthZEN
- ⬜ Gateway-issued tokens
- ⬜ Delegation grants and enforcement
- ⬜ Resume after approval
- ⬜ Kill switch everywhere
- ⬜ Richer runtime audit
- ⬜ Agent risk factors and suspension
- ⬜ Gateway security suite

## 10. Workflow, forms and configuration — 57%

- ⬜ Workflow designer
- ⬜ Event subscriptions and channels
- ⬜ Forms and e-mail templates
- 🔶 Configuration bundles
- ⬜ Certified connection types
- ✅ Onboarding templates
- ✅ Request baskets and drafts
- ✅ Request numbers (REQ and nine digits) with a barcode
- ✅ Short number keys in URLs
- ✅ AI agents found among MCP tools
- ✅ AI agents declared by MCP servers
- ✅ Old and new values in the audit trail for configuration changes
- ⬜ Generated identifiers
- ✅ Guided connector editor
- ⬜ Integrator test suite

## 11. Advanced governance — 0%

- ⬜ Mitigating controls and SoD workbench
- ⬜ Emergency and just-in-time access
- ⬜ External organizations and sponsors
- ⬜ Role mining and peer recommendations
- ⬜ SCIM receiver
- ⬜ Shared security events (SSF)
- ⬜ Cloud connectors
- ⬜ Agent discovery from A2A and SCIM

## 12. Intelligence and experience — 6%

- 🔶 Home dashboard and My Workspace
- ⬜ Insights and identity graph
- ⬜ Report builder
- ⬜ Evidence packs and posture reports
- ⬜ Risk score for every identity
- ⬜ Control history
- ⬜ Owner queues
- ⬜ Governed AI assistant

## 13. Release readiness — 100%

- ✅ Security hardening pass
- ✅ Brownfield customer rehearsal

---
Updated with every merge: change an item's mark, run `npm run roadmap` to recompute the percentages, and commit both in the same pull request.
