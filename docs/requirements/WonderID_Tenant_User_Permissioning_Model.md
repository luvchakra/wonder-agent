# WonderID — Combined Tenant & User-Level Permissioning Model

## Purpose

WonderID is a B2B multi-tenant application. Each customer organization is a first-class **Tenant** with a unique application-level URL, tenant-specific security configuration, users, groups, roles, permissions, scopes, policies, and audit boundary.

Throughout this document, **`Base App URL`** is the application URL placeholder.

Examples:

```text
https://<tenant-slug>.Base App URL
https://acme.Base App URL
```

`Base App URL` is a deployment/configuration placeholder, not a real production hostname.

---

# 1. Core Principle

The complete security chain is:

```text
Application Hostname
        ↓
Tenant Resolution
        ↓
Tenant Security Context
        ↓
Authentication
        ↓
Tenant Membership
        ↓
Groups / Roles
        ↓
Permissions
        ↓
Scope
        ↓
Authorization Policies
        ↓
Authorization Decision
        ↓
Resource Access
```

The tenant URL establishes the initial tenant context, but the URL is **not itself an authorization mechanism**.

Every tenant-owned resource must remain isolated by tenant identity and enforced by both application authorization and database-level controls.

---

# 2. Design Goals

The implementation must provide:

1. Unique URL for every tenant.
2. Strong tenant isolation.
3. Multiple users per tenant.
4. Tenant-specific authentication and SSO.
5. Tenant-specific security policies.
6. Built-in system roles.
7. Customer-defined custom roles.
8. Fine-grained permissions.
9. User-level role assignment.
10. Group-based role assignment.
11. Scoped permissions.
12. Explicit deny/restriction capability.
13. Separation of tenant and platform administration.
14. Explainable authorization decisions.
15. Full authorization auditability.
16. Access certification for WonderID users.
17. One authorization framework shared by all WonderID modules.
18. Architecture for future custom domains.
19. Shared primitives for application and runtime authorization.

---

# 3. Tenant URL

Every tenant receives:

```text
https://<tenant-slug>.Base App URL
```

Example:

```text
https://acme.Base App URL
```

The URL should remain stable for the lifetime of the tenant.

The immutable tenant ID is the actual security identity:

```text
Tenant ID:
tnt_01HACME...

Tenant Slug:
acme

Primary URL:
https://acme.Base App URL
```

The slug is an addressable alias; the tenant ID is the security identity.

---

# 4. Tenant Domain Registry

Create:

```text
tenant_domains
```

with:

```text
id
tenant_id
hostname
domain_type
status
is_primary
verified_at
created_at
updated_at
```

Domain types:

```text
PLATFORM_SUBDOMAIN
CUSTOM_DOMAIN
```

Default:

```text
hostname:
acme.Base App URL

domain_type:
PLATFORM_SUBDOMAIN
```

Future enterprise domain:

```text
hostname:
identity.acme.com

domain_type:
CUSTOM_DOMAIN
```

Custom-domain support should be designed into the model even if it is delivered later.

---

# 5. Tenant Resolution

Every request must resolve its tenant before tenant-scoped authorization.

```text
Browser
   │
   │ https://acme.Base App URL
   ▼
WonderID
   │
   ▼
Tenant Resolver
   │
   ├── Resolve hostname
   ├── Find tenant domain
   ├── Verify domain
   ├── Resolve tenant
   └── Verify tenant status
   │
   ▼
ACME Tenant Context
```

Do not use these as the security source of truth:

```text
?tenantId=...
localStorage.tenantId
client-provided tenant headers
hidden form fields
```

A client-supplied tenant identifier may be an input to validation, never proof of authorization.

---

# 6. Tenant Security Boundary

Each tenant has an independent logical security boundary.

```text
ACME Tenant
├── Users
├── Groups
├── Roles
├── Permissions
├── Security Policies
├── Applications
├── Agents
├── Identities
├── Integrations
├── Runtime Policies
├── Findings
├── Certifications
└── Audit Events
```

Tenant-owned data must never be implicitly shared with another tenant.

---

# 7. Platform Plane vs Tenant Plane

WonderID has two distinct authorization planes.

## 7.1 Platform Plane

Platform administrators operate WonderID itself.

Examples:

```text
Platform Administrator
Platform Security Administrator
Platform Operations Administrator
Platform Support Administrator
Platform Auditor
```

Example permissions:

```text
tenant.view
tenant.create
tenant.update
tenant.suspend
tenant.delete

subscription.view
subscription.manage

platform.settings.view
platform.settings.update

platform.audit.view

feature_flags.view
feature_flags.update
```

## 7.2 Tenant Plane

Tenant users operate inside one customer organization.

Examples:

```text
Tenant Administrator
Security Administrator
Identity Administrator
Agent Administrator
Runtime Security Administrator
Governance Administrator
Security Analyst
Auditor
Read Only
```

A tenant administrator never automatically receives platform-level permissions.

---

# 8. Tenant User Identity

Use a tenant membership model:

```text
User / Identity
       │
       └── Tenant Membership
                │
                ├── Status
                ├── Roles
                ├── Groups
                ├── Scope
                └── Authentication Context
```

A human identity may belong to multiple tenants.

Example:

```text
alice@example.com

Tenant A
  Security Administrator

Tenant B
  Auditor
```

Effective permissions are always evaluated inside the current tenant context.

---

# 9. Authorization Model

The preferred model is:

```text
User
  ↓
Tenant Membership
  ↓
Groups
  ↓
Roles
  ↓
Permissions
  ↓
Scope
  ↓
Conditions / Policies
  ↓
Decision
```

Roles should normally be assigned directly to users or through groups.

Avoid direct user-to-permission grants because they make access reviews and governance difficult. If introduced later for exceptions, they must be explicit, audited, and certifiable.

---

# 10. Permission Model

Use stable atomic permissions:

```text
<resource>.<action>
```

Examples:

```text
agents.view
agents.create
agents.update
agents.delete
agents.approve
agents.suspend

identities.view
identities.create
identities.update
identities.delete

access.view
access.analyze
access.export

runtime.view
runtime.control
runtime.authorize

runtime_policies.view
runtime_policies.create
runtime_policies.update
runtime_policies.publish

findings.view
findings.investigate
findings.remediate

risk.view
risk.investigate
risk.remediate

governance.view
governance.approve

certifications.view
certifications.perform
certifications.approve

audit.view
audit.export

integrations.view
integrations.create
integrations.update
integrations.delete
integrations.sync

policies.view
policies.create
policies.update
policies.publish
```

Permission IDs remain stable even when UI labels change.

---

# 11. Permission Catalog

WonderID owns the permission catalog.

Customers build roles using permissions from this catalog.

```text
Permission Catalog
────────────────────────────
agents.view
agents.create
agents.update
agents.approve
agents.suspend

runtime.view
runtime.policy.view
runtime.policy.create
runtime.policy.publish

risk.view
risk.investigate
risk.remediate

audit.view
audit.export
...
```

Customers do not invent arbitrary permission IDs.

New product capabilities can introduce new catalog permissions.

---

# 12. Resource and Action Model

Resources may include:

```text
Tenant
User
Group
Role
Agent
Agent Identity
Application
Data Source
MCP Server
Tool
Model
Integration
Runtime Policy
Governance Policy
Finding
Risk
Certification
Evidence
Audit Event
```

Actions may include:

```text
view
create
update
delete
approve
publish
execute
suspend
resume
certify
export
investigate
remediate
manage
```

Not every action is valid for every resource. The permission catalog defines valid combinations.

---

# 13. Built-In Tenant Roles

## Tenant Administrator

Full administration inside the tenant:

```text
Tenant configuration
Users
Groups
Roles
Security policies
SSO configuration
Integrations
Agents
Governance
Runtime
Audit
```

No platform permissions.

## Security Administrator

```text
Agents
Access Intelligence
Runtime Protection
Policies
Risk
Findings
Security configuration
```

## Identity Administrator

```text
Identities
IAM integrations
Access
Entitlements
Identity mappings
Identity lifecycle
```

## Agent Administrator

```text
Agent registration
Agent ownership
Agent identity
Agent lifecycle
Agent configuration
Agent policies
Agent approval
```

## Runtime Security Administrator

```text
Runtime Gateway
Runtime policies
Authorization
Tool controls
MCP runtime controls
Kill switch
Runtime investigations
```

## Governance Administrator

```text
Governance
Approvals
Certifications
Attestations
Exceptions
SoD
Evidence
```

## Security Analyst

```text
Dashboard
Agents.view
Access.view
Runtime.view
Risk.view
Findings.view
Investigations
Audit.view
```

## Auditor

Primarily read-only:

```text
Governance.view
Audit.view
Evidence.view
Certification.view
Runtime.view
```

## Read Only

Read-only access to permitted resources within the assigned scope.

---

# 14. Custom Roles

Each tenant can create custom roles.

Example:

```text
ACME AI Governance Reviewer
```

Permissions:

```text
agents.view
access.view
access.analyze
governance.view
governance.approve
certifications.view
certifications.perform
audit.view
```

Another:

```text
ACME Runtime Operator
```

Permissions:

```text
runtime.view
runtime.policy.view
runtime.policy.update
runtime.investigate
```

---

# 15. System vs Custom Roles

Roles have:

```text
SYSTEM
CUSTOM
```

System roles are created and maintained by WonderID.

Customers can assign them but should not modify their underlying definitions.

Custom roles are tenant-owned.

Suggested model:

```text
roles
────────────────────────────
id
tenant_id
name
description
type
status
is_system_role
created_at
updated_at
```

---

# 16. Groups

Groups provide scalable role assignment.

Example:

```text
ACME Security Team
├── Alice
├── Bob
├── Charlie
└── David
```

Group roles:

```text
Security Administrator
Security Analyst
```

Adding a user to the group changes their effective permissions.

---

# 17. Multiple Roles

A user may have multiple roles.

```text
Alice
├── Security Analyst
└── Agent Administrator
```

Or:

```text
Priya
├── Auditor
└── Governance Reviewer
```

Effective permissions are derived from valid direct roles and group roles, subject to scope and policy restrictions.

---

# 18. Scope

Roles must support scope.

Model:

```text
Role Assignment
      +
Scope
```

Examples:

```text
Security Administrator
Scope: Entire Tenant
```

```text
Agent Administrator
Scope: Production
```

```text
Auditor
Scope: APAC
```

```text
Security Analyst
Scope: Selected Applications
```

---

# 19. Scope Hierarchy

The model should support:

```text
Tenant
  │
  ├── Organization / Business Unit
  │
  ├── Environment
  │      ├── Development
  │      ├── Test
  │      └── Production
  │
  ├── Application
  │
  ├── Agent
  │
  ├── Identity
  │
  └── Resource
```

The first release may use a smaller subset, but the data model should not prevent future scope types.

---

# 20. Conditions

Scope answers:

> Where can the user operate?

Conditions answer:

> Under what circumstances?

Examples:

```text
MFA required
Corporate network required
Trusted device required
Business hours only
Approval required
Step-up authentication required
```

Example:

```text
Permission:
runtime.policy.publish

Scope:
Production

Conditions:
MFA required
AND
Security approval required
```

---

# 21. Explicit Deny and Restrictions

The authorization model should support deterministic deny/restriction rules.

Example:

```text
Role:
Security Administrator

Allows:
runtime.*

Policy:
Production Kill Switch

Deny:
runtime.kill_switch

Exception:
Break Glass Administrator
```

Conceptual evaluation order:

```text
1. Tenant validity
2. User authentication
3. Tenant membership
4. User status
5. Role assignment
6. Group membership
7. Permission
8. Scope
9. Conditions
10. Explicit deny/restriction
11. Resource policy
12. Final decision
```

---

# 22. Authorization Decisions

Application authorization should produce:

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

Additional restricted outcomes can be introduced later.

Sensitive decisions should have deterministic explanations.

---

# 23. Authorization Explanation

Example:

```text
Why can Alice publish this runtime policy?

Decision: ALLOW

User:
Alice Smith

Tenant:
ACME Corporation

Role:
Runtime Security Administrator

Permission:
runtime.policy.publish

Scope:
Production

Conditions:
MFA satisfied

Policy:
Production Runtime Policy Administration

Decision:
ALLOW
```

Denial:

```text
Why can't Bob publish this runtime policy?

Decision: DENY

User:
Bob Jones

Role:
Security Analyst

Granted:
runtime.policy.view

Missing:
runtime.policy.publish

Required:
Runtime Security Administrator
```

Explanations must be generated from deterministic authorization facts, not an LLM's independent judgment.

---

# 24. Application Authorization vs Runtime Authorization

WonderID has two related but distinct authorization domains.

## Application Authorization

Human user:

> Can I modify this runtime policy?

```text
Human User
   ↓
Tenant Membership
   ↓
Role
   ↓
Permission
   ↓
Scope
   ↓
Policy
   ↓
Decision
```

## Runtime Authorization

AI agent:

> Can I execute this tool/action?

```text
AI Agent
   ↓
Agent Identity
   ↓
Intent
   ↓
Context
   ↓
Risk
   ↓
Runtime Policy
   ↓
Tool/Data Scope
   ↓
Decision
```

Both should use shared authorization primitives and policy infrastructure where appropriate.

---

# 25. Shared Authorization Architecture

```text
                    WonderID Authorization
                            │
              ┌─────────────┴─────────────┐
              │                           │
      Application Authorization     Runtime Authorization
              │                           │
          Human User                 AI Agent / NHI
              │                           │
      Roles / Permissions          Identity / Intent
              │                           │
            Scope                    Context / Risk
              │                           │
              └─────────────┬─────────────┘
                            │
                     Policy Engine
                            │
                     Decision Engine
                            │
                  ┌─────────┴─────────┐
                  │                   │
                ALLOW                DENY
                  │
                  └── REQUIRE_APPROVAL
```

LLMs may assist with classification, explanation, investigation and recommendation, but deterministic security decisions must not depend solely on an LLM.

---

# 26. Tenant Security Profile

Every tenant receives tenant-level security defaults.

Example:

```text
Tenant Security Profile
────────────────────────────────────

Authentication
  SSO required
  Password login disabled
  MFA required

Session
  Session timeout: 30 minutes
  Idle timeout: 15 minutes

Network
  IP restrictions enabled

Identity
  User lifecycle enabled
  Access certification every 90 days

AI Agent Security
  Agent registration required
  Production approval required
  Runtime authorization enabled
  High-risk actions require approval

Audit
  Audit logging enabled
  Evidence retention: 7 years
```

---

# 27. Authentication Configuration

Authentication and authorization are separate.

Authentication:

> Who are you?

Authorization:

> What can you do?

Tenant authentication can configure:

```text
SAML SSO
OIDC
MFA
Password authentication
Identity provider
Session duration
Authentication requirements
```

Example:

```text
https://acme.Base App URL
        ↓
ACME Tenant
        ↓
ACME Identity Provider
        ↓
Alice
        ↓
ACME Membership
        ↓
Roles / Groups / Permissions
```

---

# 28. Tenant Login

Opening:

```text
https://acme.Base App URL
```

should immediately establish the ACME context.

Example:

```text
ACME Corporation

Sign in to WonderID

Work email
[________________________]

[ Continue ]

or

[ Continue with ACME SSO ]

Your organization requires single sign-on.
```

A tenant-specific URL should not require a tenant-selection screen.

---

# 29. Tenant Administration UI

Recommended:

```text
Administration

  Organization
    General
    Domains
    Branding

  Access Control
    Users
    Groups
    Roles
    Permissions

  Authentication
    SSO
    MFA
    Sessions

  Security
    Security Policies
    Access Policies
    Runtime Policies
    Risk Policies

  Audit
    Access Audit
    Administrative Audit
```

---

# 30. Users Screen

```text
Administration
  > Access Control
    > Users

Users

[ Search users... ]          [ Invite User ]

Name             Email                 Role           Status
────────────────────────────────────────────────────────────
Alice Smith      alice@acme.com       Security Admin Active
Bob Jones        bob@acme.com         Auditor        Active
Charlie Rao      charlie@acme.com     Analyst        Active
Emma Wilson      emma@acme.com       Agent Admin    Active
```

---

# 31. User Detail

```text
Alice Smith
alice@acme.com
● Active

Tenant
ACME Corporation

Authentication
SSO
MFA Enabled

Roles
────────────────────────────
Security Administrator
Scope: Entire Tenant

Agent Administrator
Scope: Production

Groups
────────────────────────────
Security Team
AI Governance Team

Effective Permissions
────────────────────────────
247 permissions

Access Review
────────────────────────────
Last certified:
01 Jul 2026

Next certification:
01 Oct 2026
```

---

# 32. Role Designer

```text
Create Role

Role Name
[ AI Governance Reviewer ]

Description
[ Reviews AI agent governance ]

Permissions

DISCOVER
☑ Agents — View
☐ Agents — Create
☐ Agents — Delete

UNDERSTAND
☑ Access — View
☑ Access — Analyze

GOVERN
☑ Governance — View
☑ Approvals — View
☑ Approvals — Approve
☑ Certifications — View
☑ Certifications — Perform

PROTECT
☐ Runtime Policy — Modify
☐ Kill Switch

ASSURE
☑ Risk — View
☑ Findings — Investigate
☑ Audit — View

Scope
○ Entire Tenant
○ Environment
○ Selected Resources

[ Cancel ]                  [ Create Role ]
```

---

# 33. Authorization Evaluation

Every sensitive application request should evaluate:

```text
Tenant
User
Authentication
Membership
Roles
Groups
Permissions
Scope
Conditions
Policies
Resource
Action
```

Conceptual request:

```json
{
  "tenant": "tnt_01HACME",
  "subject": "usr_123",
  "resource": "runtime_policy",
  "resource_id": "pol_456",
  "action": "publish",
  "context": {
    "environment": "production",
    "mfa": true
  }
}
```

Conceptual response:

```json
{
  "decision": "ALLOW",
  "reason_codes": [
    "TENANT_MATCH",
    "ROLE_MATCH",
    "PERMISSION_MATCH",
    "SCOPE_MATCH",
    "MFA_SATISFIED"
  ]
}
```

The exact API contract can be refined during implementation.

---

# 34. Authorization Audit

Every security-sensitive authorization event should be auditable.

Example:

```text
Authorization Audit Event

Timestamp:
26 Sep 2026 10:42 IST

Tenant:
ACME Corporation

User:
Alice Smith

Action:
Publish Runtime Policy

Resource:
Production Runtime Policy

Permission:
runtime.policy.publish

Role:
Runtime Security Administrator

Scope:
Production

Decision:
ALLOW

Authentication:
SSO + MFA

Policy:
Production Runtime Policy Administration

Reason:
All required authorization conditions satisfied
```

---

# 35. User Access Certification

WonderID should eventually govern access to WonderID itself.

Example:

```text
Quarterly Access Certification

ACME Corporation

12 Administrators
4 Runtime Administrators
7 Governance Reviewers
18 Analysts

Alice Smith
Security Administrator
Scope: Entire Tenant

[ Certify ]                 [ Revoke ]
```

Certification events become audit evidence.

---

# 36. Database Model

Core tables:

```text
tenants
tenant_domains
tenant_security_profiles

users
tenant_memberships

groups
group_members

roles
permissions

role_permissions
user_roles
group_roles

scopes
role_scopes

authorization_policies
authorization_decisions

access_certifications
access_certification_items

audit_events
```

Relationships:

```text
TENANT
  │
  ├── TENANT_DOMAIN
  ├── TENANT_SECURITY_PROFILE
  ├── TENANT_MEMBERSHIP ── USER
  ├── GROUP ── GROUP_MEMBER ── USER
  ├── ROLE ── ROLE_PERMISSION ── PERMISSION
  ├── USER_ROLE
  ├── GROUP_ROLE
  ├── SCOPE
  ├── ROLE_SCOPE
  ├── AUTHORIZATION_POLICY
  ├── AUTHORIZATION_DECISION
  └── AUDIT_EVENT
```

---

# 37. Suggested User Tables

```text
users
────────────────────
id
identity_id
email
display_name
status
created_at
updated_at
```

```text
tenant_memberships
────────────────────────────
id
tenant_id
user_id
status
joined_at
last_access_at
created_at
updated_at
```

A membership is the authoritative relationship between a human identity and a tenant.

---

# 38. Role and Permission Tables

```text
roles
────────────────────────────
id
tenant_id
name
description
type
status
is_system_role
created_at
updated_at
```

```text
permissions
────────────────────────────
id
resource
action
description
module
```

```text
role_permissions
────────────────────────────
role_id
permission_id
```

```text
user_roles
────────────────────────────
user_id
role_id
scope_id
```

```text
group_roles
────────────────────────────
group_id
role_id
scope_id
```

---

# 39. RLS and Tenant Isolation

Every tenant-owned table should contain `tenant_id` where appropriate.

Example:

```text
agents
────────────────────────────
id
tenant_id
name
owner_id
status
...
```

```text
runtime_events
────────────────────────────
id
tenant_id
agent_id
event_type
decision
timestamp
...
```

```text
roles
────────────────────────────
id
tenant_id
name
type
...
```

Supabase RLS must independently enforce tenant isolation.

Application filtering must never be the only security boundary.

---

# 40. Cross-Tenant Protection

Example:

```text
ACME user
   ↓
Request for Contoso resource
   ↓
DENY
```

Knowing another tenant's resource ID must not provide access.

Resource IDs are never authorization.

Every tenant-scoped query must be tenant-aware, and RLS must independently enforce the same boundary.

---

# 41. API Security

Tenant-facing API requests must resolve:

```text
hostname
    ↓
tenant
    ↓
authenticated identity
    ↓
tenant membership
    ↓
permission
    ↓
scope
```

Example:

```text
https://acme.Base App URL/api/v1/agents
```

A request such as:

```text
POST /api/v1/agents?tenant_id=contoso
```

must not be sufficient to change tenant context.

---

# 42. Permission Caching

If permissions are cached, cache keys must include tenant and identity context.

Bad:

```text
permissions:user_123
```

Preferred:

```text
permissions:<tenant_id>:<user_id>:<role_version>
```

Invalidate authorization caches when:

```text
User disabled
Role changed
Group membership changed
Permission changed
Scope changed
Security policy changed
Tenant suspended
```

Sensitive operations should use a fresh/strongly consistent authorization path where required.

---

# 43. Break-Glass Access

Future controlled emergency access should support:

```text
Break Glass Administrator

Requirements:
- Strong authentication
- Explicit reason
- Time-limited access
- Approval or emergency policy
- Full audit
- Automatic expiration
```

Flow:

```text
User
 ↓
Activate Break Glass
 ↓
Strong Authentication
 ↓
Reason
 ↓
Temporary elevated permissions
 ↓
Automatic expiry
 ↓
Audit / Review
```

---

# 44. WonderID Module Integration

All WonderID modules consume the same authorization framework:

```text
DISCOVER
   ↓
UNDERSTAND
   ↓
GOVERN
   ↓
PROTECT
   ↓
ASSURE
```

Examples:

```text
Discover
  agents.view

Understand
  access.view
  access.analyze

Govern
  governance.approve
  certifications.perform

Protect
  runtime.policy.publish
  runtime.control

Assure
  risk.investigate
  findings.remediate
  audit.export
```

Do not create separate role systems inside individual modules.

---

# 45. Request Context

Every request should conceptually produce:

```text
Tenant Context
────────────────────────
tenant_id
tenant_status
tenant_security_profile
tenant_domain

Identity Context
────────────────────────
user_id
authentication_method
mfa_status
session
membership_status

Authorization Context
────────────────────────
roles
groups
permissions
scopes
conditions
policies
```

Then:

```text
Tenant Context
      +
Identity Context
      +
Authorization Context
      +
Requested Resource
      +
Requested Action
      ↓
Authorization Engine
      ↓
Decision
```

---

# 46. Recommended P0 Stories

## TENANT-001 — Tenant Identity

Create first-class tenant entity.

Acceptance:

- Immutable tenant ID.
- Unique tenant slug.
- Tenant status.
- Activation/suspension.
- Tenant isolation.

## TENANT-002 — Tenant Application URL

Implement:

```text
https://<tenant-slug>.Base App URL
```

Acceptance:

- Unique slug.
- Hostname resolves to correct tenant.
- Invalid hostname rejected.
- Suspended tenant cannot authenticate.
- Tenant context is server-side.

## TENANT-003 — Tenant Domain Registry

Implement `tenant_domains`.

Acceptance:

- Primary platform domain.
- Domain verification model.
- Custom-domain architecture.
- Domain status.
- Tenant mapping.

## TENANT-004 — Tenant Security Profile

Implement:

- Authentication settings.
- MFA settings.
- Session settings.
- Security defaults.
- AI agent security settings.
- Audit settings.

## IAM-001 — Tenant Membership

Acceptance:

- User can belong to tenant.
- Membership has status.
- Suspended membership cannot access tenant.
- Membership is tenant-scoped.

## IAM-002 — Permission Catalog

Acceptance:

- Resource/action model.
- Stable IDs.
- Descriptions.
- Module mapping.

## IAM-003 — Roles

Acceptance:

- System roles protected.
- Custom roles tenant-owned.
- Role lifecycle.
- Role-permission mapping.

## IAM-004 — Groups

Acceptance:

- Group membership.
- Group-role assignments.
- Effective permissions include group roles.

## IAM-005 — Scoped Authorization

Acceptance:

- Tenant scope.
- Environment scope foundation.
- Resource scope foundation.
- Scope evaluated during authorization.

## IAM-006 — Authorization Engine

Acceptance:

- Tenant validation.
- Membership validation.
- Role resolution.
- Permission resolution.
- Scope evaluation.
- Conditions.
- Deny/restriction.
- ALLOW/DENY/REQUIRE_APPROVAL.

## IAM-007 — Authorization Explanation

Sensitive decisions expose deterministic reason codes and authorization facts.

## IAM-008 — Access Audit

Record:

```text
Who
Tenant
What
Resource
Action
Permission
Role
Scope
Decision
Timestamp
Authentication Context
Policy
Reason
```

## IAM-009 — User Access Certification

Support certification of privileged WonderID users.

## IAM-010 — Tenant Administration UI

Build:

```text
Users
Groups
Roles
Permissions
Access Reviews
```

---

# 47. P1 Extensions

```text
Custom domains
Advanced attribute-based access control
Dynamic scopes
Business-unit hierarchy
Environment hierarchy
Delegated administration
Just-in-time administrative access
Break-glass access
Access request workflows
Temporary role assignments
Step-up authentication
Device-aware authorization
Network-aware authorization
Risk-aware application authorization
SCIM provisioning
Advanced identity lifecycle
Service accounts
API clients
Machine identities
```

---

# 48. P2 Extensions

```text
Policy simulation
Authorization what-if analysis
Access optimization
Automated least privilege
AI-assisted role recommendations
AI-assisted access review
Entitlement mining
Role mining
Peer-group analysis
Predictive access risk
Automated remediation
```

AI can recommend, explain and analyze, but deterministic policy evaluation remains authoritative.

---

# 49. Final End-to-End Architecture

```text
                         WONDERID
                            │
                  ┌─────────┴─────────┐
                  │                   │
            PLATFORM PLANE       TENANT PLANE
                  │                   │
        Platform Administrators       │
                  │                   │
            Tenant Management         │
                                      │
        ┌─────────────────────────────┼──────────────────────┐
        │                             │                      │
        ▼                             ▼                      ▼
     ACME Tenant                CONTOSO Tenant          XYZ Tenant
        │
        │
https://acme.Base App URL
        │
        ▼
 Tenant Resolution
        │
        ▼
 Tenant Security Context
        │
        ▼
 Authentication
        │
        ▼
 Tenant Membership
        │
        ├───────────────┐
        │               │
        ▼               ▼
      Groups          Direct Roles
        │               │
        └───────┬───────┘
                ▼
              Roles
                │
                ▼
           Permissions
                │
                ▼
              Scope
                │
                ▼
           Conditions
                │
                ▼
          Security Policies
                │
                ▼
       Authorization Engine
                │
       ┌────────┼─────────┐
       ▼        ▼         ▼
     ALLOW     DENY   APPROVAL
                │
                ▼
          Resource Access
                │
                ▼
             Audit
```

---

# 50. Final Design Principle

The WonderID model is:

> **A tenant defines the security boundary. A user establishes identity within that boundary. Groups and roles define organizational responsibility. Permissions define capabilities. Scopes define where those capabilities apply. Policies and conditions define when they apply. The authorization engine produces a deterministic decision, and every sensitive decision is auditable.**

The tenant URL:

```text
https://<tenant-slug>.Base App URL
```

is the customer's application entry point.

The authorization foundation is:

```text
Tenant
→ Membership
→ Groups
→ Roles
→ Permissions
→ Scope
→ Policy
→ Decision
```

This authorization framework must be implemented once and consumed consistently by Discover, Understand, Govern, Protect and Assure.
