# WonderID — Tenant User, Role & Permission Management
## Detailed Product & Implementation Requirements

**Document type:** Product + UX + Technical Implementation Requirements  
**Product:** WonderID  
**Scope:** Multi-tenant organization access, users, groups, roles, permissions, scopes, authorization and access certification  
**Base URL placeholder:** `Base App URL`  
**Status:** Implementation-ready specification

---

# 1. Objective

WonderID is a B2B multi-tenant application where each customer organization operates inside its own tenant.

Each tenant must have:

```text
https://<tenant-slug>.Base App URL
```

The tenant administrator must be able to:

- Add multiple users.
- Invite users to the tenant.
- Assign one or more roles.
- Assign users to groups.
- Create custom roles.
- Select granular application permissions.
- Restrict roles by scope.
- Review effective permissions.
- Remove or suspend users.
- Manage user access over time.
- Certify privileged access.
- Delegate administration safely to other users.

The central principle is:

```text
Tenant
  ↓
User / Membership
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
Authorization Decision
```

The authorization model must be shared across all WonderID modules.

---

# 2. Important Security Principle

The tenant URL identifies the application context:

```text
https://acme.Base App URL
```

It does **not** by itself authorize access.

Every request must pass:

```text
Tenant Resolution
        ↓
Authentication
        ↓
Tenant Membership
        ↓
Role Resolution
        ↓
Permission Evaluation
        ↓
Scope Evaluation
        ↓
Policy / Condition Evaluation
        ↓
Authorization Decision
```

Database-level tenant isolation must independently enforce:

```text
tenant_id = authenticated_tenant_id
```

through Supabase RLS.

---

# 3. Tenant URL Model

## 3.1 Tenant URL

Every tenant receives a unique platform URL:

```text
https://<tenant-slug>.Base App URL
```

Example:

```text
https://acme.Base App URL
```

The tenant slug must be:

- Unique.
- URL-safe.
- Case-insensitive.
- Immutable by default.
- Reserved-word protected.
- Validated before creation.

## 3.2 Tenant Domain Table

Create:

```text
tenant_domains
```

Fields:

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

Supported domain types:

```text
PLATFORM_SUBDOMAIN
CUSTOM_DOMAIN
```

Initial implementation:

```text
https://<tenant-slug>.Base App URL
```

Future implementation may support:

```text
https://identity.customer.com
```

---

# 4. Tenant Administration Boundary

WonderID must distinguish:

## Platform Administration

Operates WonderID itself.

Examples:

```text
Platform Administrator
Platform Security Administrator
Platform Operations Administrator
Platform Auditor
```

## Tenant Administration

Operates a customer's WonderID tenant.

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

A tenant administrator must never automatically receive platform-level permissions.

---

# 5. Tenant Membership

A user is not authorized merely because their email exists.

The user must have an active membership in the tenant.

Recommended structure:

```text
users
    │
    └── tenant_memberships
             │
             ├── status
             ├── roles
             ├── groups
             └── scopes
```

Membership statuses:

```text
INVITED
ACTIVE
SUSPENDED
DEACTIVATED
REMOVED
```

Only an `ACTIVE` membership can normally access the tenant.

---

# 6. Users

## 6.1 Users List

Navigation:

```text
Administration
  └── Access Control
        └── Users
```

The Users screen must provide:

- Search.
- Status filter.
- Role filter.
- Group filter.
- Scope filter.
- Invite User.
- Bulk actions where safe.
- Pagination.
- User status.
- Last activity.
- Role summary.
- Group summary.

Example:

```text
Users

[ Search users... ]       [Status] [Role] [Group] [Filter]
                                           [ + Add User ]

Name             Email              Roles             Status
----------------------------------------------------------------
Priya Sharma     priya@acme.com     Tenant Admin      Active
Amit Patel       amit@acme.com      Identity Admin    Active
Neha Kapoor      neha@acme.com      Analyst           Active
Rohan Mehta      rohan@acme.com     Read Only         Active
Sneha Iyer       sneha@acme.com     Governance Admin  Active
Vikram Singh     vikram@acme.com    Custom Role       Inactive
```

---

# 7. User Invitation

Tenant administrators and appropriately delegated administrators can create/invite users.

Required fields:

```text
Full Name
Email Address
Job Title
Department
Account Type
Authentication Method
```

Account types:

```text
Internal User
External / Contractor
Service Account
```

Service accounts should use a separate machine-identity lifecycle and must not be treated exactly like human users.

Authentication options:

```text
Tenant Default SSO
Email + Password
Invite via SSO
```

Tenant security policy determines which choices are actually available.

---

# 8. User Creation Workflow

The user creation wizard should use:

```text
1. Basic Details
2. Roles & Permissions
3. Scope & Conditions
4. Review
5. Create / Invite
```

## Step 1 — Basic Details

Fields:

```text
Full Name *
Email Address *
Job Title
Department
Account Type
Authentication Method
Invitation Method
```

Options:

```text
Send email invite
Create immediately
Invite via SSO
```

Security rules must prevent administrators from bypassing tenant-level authentication requirements.

---

# 9. Assign Roles

Step 2:

```text
Roles & Permissions
```

Display:

```text
[ Search roles... ]

Role                          Description                         Type
---------------------------------------------------------------------------
☑ Tenant Administrator       Full tenant administration          System
☑ Security Administrator     Security configuration              System
☐ Identity Administrator     Manage identities and IAM           System
☐ Agent Administrator        Manage AI agents                    System
☐ Runtime Security Admin     Manage runtime policies             System
☐ Governance Administrator   Manage governance and approvals     System
☐ Security Analyst           Investigate security risks           System
☐ Auditor                    Read-only audit access               System
☐ Read Only                  Read-only access                     System
☐ Compliance Reviewer        Review compliance evidence           Custom
```

Role selection must support:

- Multiple roles.
- Search.
- System/custom filtering.
- Role description.
- Permission preview.
- Scope preview.

---

# 10. Role Assignment Rules

A role assignment must contain:

```text
User
Role
Tenant
Scope
Assignment Source
Start Time
End Time
Assigned By
```

Assignment source:

```text
DIRECT
GROUP
POLICY
SYSTEM
```

Optional future capability:

```text
TEMPORARY
```

Temporary role assignments must expire automatically.

---

# 11. Groups

Groups allow administrators to manage access at scale.

Navigation:

```text
Administration
  └── Access Control
        └── Groups
```

Example:

```text
Security Team
AI Governance Team
IAM Team
SOC Team
Application Owners
Compliance Team
```

A group can contain users and have role assignments.

Example:

```text
AI Governance Team
        │
        ├── Alice
        ├── Bob
        ├── Priya
        └── Raj
        │
        └── Governance Reviewer
```

---

# 12. Group-Based Authorization

Effective permissions must combine:

```text
Direct User Roles
+
Group Roles
```

Example:

```text
Alice

Direct:
Agent Administrator

Group:
AI Governance Team
  → Governance Reviewer
```

Effective access:

```text
Agent Administrator
+
Governance Reviewer
```

Group membership changes must invalidate authorization caches.

---

# 13. Permission Catalog

WonderID owns a centralized permission catalog.

Permission format:

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
```

Customers cannot invent arbitrary permission identifiers.

---

# 14. Permission Grouping by WonderID Module

Permissions should be organized in the UI according to the product architecture.

## DISCOVER

```text
discovery.view
agents.view
agents.create
agents.update
agents.approve
applications.view
data_sources.view
models.view
tools.view
```

## UNDERSTAND

```text
access.view
access.analyze
access.export
access_graph.view
identity_mappings.view
effective_access.view
```

## GOVERN

```text
governance.view
governance.create
governance.update
governance.approve
certifications.view
certifications.perform
certifications.approve
exceptions.view
exceptions.create
```

## PROTECT

```text
runtime.view
runtime.control
runtime.authorize
runtime_policies.view
runtime_policies.create
runtime_policies.update
runtime_policies.publish
tool_controls.view
tool_controls.update
credentials.view
credentials.manage
```

## ASSURE

```text
risk.view
risk.investigate
findings.view
findings.investigate
findings.remediate
evidence.view
evidence.export
audit.view
audit.export
```

---

# 15. Custom Role Creation

Tenant administrators with:

```text
roles.create
roles.update
roles.manage
```

may create custom roles.

Navigation:

```text
Administration
  → Access Control
    → Roles
      → Create Role
```

Wizard:

```text
1. Basic Details
2. Permissions
3. Scope & Conditions
4. Review
```

---

# 16. Custom Role — Basic Details

Fields:

```text
Role Name *
Description *
Role Type
```

Role type:

```text
Custom Role
Copy Existing Role
```

Example:

```text
Role Name:
Compliance Reviewer

Description:
Can view and review compliance evidence,
run reports and approve certifications.

Type:
Custom Role
```

---

# 17. Custom Role Permissions

The permissions UI must be grouped by module.

Example:

```text
Governance Permissions

☑ governance.view
☑ governance.approve
☑ certification.view
☑ certification.perform
☐ certification.approve

Policy Permissions

☑ policy.view
☐ policy.create
☐ policy.update
```

Each permission must display:

```text
Permission
Description
Resource Type
```

Support:

```text
Search permissions
Select all
Clear all
Expand/collapse module
```

Do not expose raw database permission IDs as the primary UI language.

---

# 18. Scope Configuration

A role assignment or custom role may be restricted by scope.

Supported initial scopes:

```text
Entire Tenant
Selected Environment
Selected Application
Selected Agent
Selected Resource
```

Example:

```text
Role:
Agent Administrator

Scope:
Production
```

Another:

```text
Role:
Auditor

Scope:
Selected Applications
  Salesforce
  ServiceNow
  Customer Portal
```

---

# 19. Scope UI

Example:

```text
Scope

○ Entire Tenant

○ Selected Environments
   ☑ Production
   ☐ Test
   ☐ Development

○ Selected Applications
   [ Select applications ]

○ Selected Agents
   [ Select agents ]
```

The UI must clearly explain:

> This role will only apply to resources inside the selected scope.

---

# 20. Conditions

Optional conditions may further restrict access.

Examples:

```text
MFA required
Trusted device required
Corporate network required
Business hours only
Approval required
Step-up authentication required
```

Example:

```text
Additional Conditions

Region:
[ APAC ▼ ]

Department:
[ Security ▼ ]

Time restriction:
○ No restriction
○ Specific time range
○ Working hours only
```

Conditions must be evaluated server-side.

---

# 21. Role Review

Before creation, display:

```text
Role Summary

Compliance Reviewer
Custom Role

Description:
Can view and review compliance data,
run reports and approve certifications.

Permissions
✓ governance.view
✓ governance.approve
✓ certification.view
✓ certification.perform
✓ policy.view
✓ audit.view
✓ audit.export
✓ evidence.view

Scope
Environment:
Production
Test

Conditions:
No additional restrictions
```

Actions:

```text
[ Back ]
[ Create Role ]
```

---

# 22. Built-In Role Details

System roles require a read-only role definition page.

Example:

```text
Security Administrator
● System Role

Manage security configuration,
policies, agents and risk controls.

Tabs:

Overview
Permissions
Users
Groups
Scope Rules
Related Roles
```

Display:

```text
Permission Summary

Agents             18 / 22
Access Intelligence 12 / 15
Governance           8 / 10
Runtime Protection  15 / 18
Risk & Investigations 10 / 14
Audit & Compliance   12 / 12
Integrations          6 / 8
Administration        5 / 8
```

System roles cannot be edited by tenant users.

---

# 23. User Detail

User detail must show both assigned and effective access.

Header:

```text
Anita Desai
anita@acme.com
● Active

Compliance Manager
Risk & Compliance
```

Tabs:

```text
Roles & Groups
Effective Permissions
Access History
Sessions
Activity Log
```

---

# 24. User — Roles & Groups

Display direct assignments:

```text
Assigned Roles

Security Administrator
Type: System
Scope: Production
Assigned On: 12 Sep 2026
Assigned By: Priya Sharma

Compliance Reviewer
Type: Custom
Scope: Production, Test
Assigned On: 12 Sep 2026
Assigned By: Priya Sharma
```

Groups:

```text
Groups

Compliance Team
8 members

Risk & Compliance
12 members
```

Actions:

```text
+ Assign Role
+ Add to Group
Edit User
Suspend User
```

---

# 25. Effective Permissions

The system must distinguish:

```text
Assigned Permission
Effective Permission
```

A user may have a permission through multiple paths.

Example:

```text
Effective Permission:
governance.approve

Sources:
✓ Security Administrator
✓ Compliance Reviewer
```

The UI should explain permission provenance.

Example:

```text
Why does Anita have this permission?

governance.approve

Granted through:
Compliance Reviewer
Scope:
Production

Also inherited from:
Security Administrator
```

---

# 26. Authorization Precedence

Authorization should follow deterministic rules.

Conceptual order:

```text
1. Tenant valid
2. User authenticated
3. Membership active
4. User not suspended
5. Resolve direct roles
6. Resolve group roles
7. Resolve permissions
8. Resolve scope
9. Evaluate conditions
10. Evaluate explicit deny/restriction
11. Evaluate resource policy
12. Produce decision
```

Final application decision:

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

---

# 27. Admin Delegation

The model must support more than one administrator.

Example:

```text
Priya Sharma
Tenant Administrator

Can:
✓ Create users
✓ Invite users
✓ Create groups
✓ Create custom roles
✓ Assign roles
✓ Remove roles
✓ Suspend users
✓ Review access
```

A delegated administrator may have:

```text
User Administrator
```

with only:

```text
users.view
users.create
users.update
users.suspend
```

and no authority to create or change roles.

This allows separation of duties.

---

# 28. Administrative Permissions

Important administration permissions:

```text
users.view
users.create
users.update
users.suspend
users.remove
users.invite

groups.view
groups.create
groups.update
groups.delete
groups.manage_members

roles.view
roles.create
roles.update
roles.delete
roles.assign

permissions.view

access_reviews.view
access_reviews.perform
```

Highly privileged permissions should be separately controllable:

```text
tenant.security.manage
authentication.manage
sso.manage
mfa.manage
runtime.kill_switch
roles.manage
```

---

# 29. Separation of Duties

The system should support separation between:

```text
User Administrator
Role Administrator
Security Administrator
Auditor
```

Example:

```text
User Administrator
  Can create user
  Cannot modify security policies

Role Administrator
  Can create roles
  Cannot approve own privileged access

Auditor
  Can view access
  Cannot modify access
```

For sensitive operations, the system should support:

```text
Requester
   ↓
Approval
   ↓
Execution
```

rather than allowing one administrator to perform all actions without controls.

---

# 30. Self-Privilege Protection

Administrators must not be able to silently escalate themselves.

Example:

```text
Current User:
Bob

Attempt:
Assign Tenant Administrator to Bob

Policy:
Self-privilege escalation prohibited

Decision:
DENY
```

Possible controlled alternative:

```text
Request elevation
      ↓
Independent approval
      ↓
Temporary role
      ↓
Audit
```

---

# 31. Last Administrator Protection

The system must prevent accidental removal of the final tenant administrator.

Example:

```text
ACME has:
1 Tenant Administrator
```

Attempt:

```text
Remove Tenant Administrator
```

Result:

```text
DENY

This action would leave the tenant without
a Tenant Administrator.

Assign another administrator before removing
this role.
```

---

# 32. User Suspension

Suspending a user must immediately prevent tenant access.

Actions:

```text
Suspend User
Revoke Sessions
Revoke Active Tokens
Disable Invitations
```

Audit event:

```text
USER_SUSPENDED
```

Required fields:

```text
tenant_id
user_id
performed_by
reason
timestamp
```

---

# 33. Session Management

User detail should expose active sessions:

```text
Sessions

Chrome
Windows
Mumbai
Active now

Safari
MacOS
Mumbai
2 hours ago

[ Revoke All Sessions ]
```

Session revocation should immediately invalidate active sessions where technically supported.

---

# 34. Access History

Show:

```text
Role assigned
Role removed
Group added
Group removed
Permission changed
Scope changed
User suspended
User activated
Login
Logout
Session revoked
```

Each event includes:

```text
Timestamp
Actor
Action
Target
Previous State
New State
Reason
```

---

# 35. Access Certification

Tenant administrators and auditors should eventually certify privileged access.

Example:

```text
Quarterly Access Review

ACME Corporation

Administrators: 12
Runtime Administrators: 4
Governance Reviewers: 7
Analysts: 18
```

Each item:

```text
Alice Smith
Security Administrator
Scope: Entire Tenant

[ Certify ] [ Revoke ]
```

Certification decisions become audit evidence.

---

# 36. Audit Requirements

All privileged IAM operations must be logged.

Minimum events:

```text
TENANT_CREATED
TENANT_SUSPENDED

USER_INVITED
USER_CREATED
USER_UPDATED
USER_SUSPENDED
USER_REMOVED

GROUP_CREATED
GROUP_UPDATED
GROUP_DELETED
GROUP_MEMBER_ADDED
GROUP_MEMBER_REMOVED

ROLE_CREATED
ROLE_UPDATED
ROLE_DELETED
ROLE_ASSIGNED
ROLE_REMOVED

PERMISSION_CHANGED
SCOPE_CHANGED

AUTHORIZATION_ALLOWED
AUTHORIZATION_DENIED
AUTHORIZATION_APPROVAL_REQUIRED

SESSION_REVOKED

ACCESS_CERTIFIED
ACCESS_REVOKED
```

Audit records must be immutable from normal tenant UI operations.

---

# 37. Database Model

Recommended tables:

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

sessions

audit_events
```

Important relationships:

```text
TENANT
 │
 ├── TENANT_DOMAIN
 ├── TENANT_SECURITY_PROFILE
 ├── TENANT_MEMBERSHIP ── USER
 │
 ├── GROUP ── GROUP_MEMBER ── USER
 │
 ├── ROLE ── ROLE_PERMISSION ── PERMISSION
 │
 ├── USER_ROLE
 ├── GROUP_ROLE
 ├── SCOPE
 ├── ROLE_SCOPE
 │
 ├── AUTHORIZATION_POLICY
 ├── AUTHORIZATION_DECISION
 │
 └── AUDIT_EVENT
```

---

# 38. Suggested Schema

## tenants

```text
id
name
slug
status
created_at
updated_at
```

## tenant_domains

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

## users

```text
id
identity_id
email
display_name
status
created_at
updated_at
```

## tenant_memberships

```text
id
tenant_id
user_id
status
joined_at
last_access_at
created_at
updated_at
```

## groups

```text
id
tenant_id
name
description
status
created_at
updated_at
```

## group_members

```text
group_id
user_id
created_at
```

## roles

```text
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

## permissions

```text
id
resource
action
description
module
```

## role_permissions

```text
role_id
permission_id
```

## user_roles

```text
user_id
role_id
scope_id
starts_at
expires_at
assigned_by
created_at
```

## group_roles

```text
group_id
role_id
scope_id
created_at
```

---

# 39. RLS Requirements

All tenant-owned tables must be protected by Supabase RLS.

The security invariant is:

```text
request.tenant_id == row.tenant_id
```

where applicable.

Do not depend solely on:

```text
WHERE tenant_id = ...
```

in application code.

RLS must independently prevent cross-tenant access.

---

# 40. Authorization Service

Implement one shared service.

Conceptual API:

```typescript
authorize({
  tenantId,
  subjectId,
  resource,
  resourceId,
  action,
  context
})
```

Response:

```typescript
{
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL",
  reasonCodes: string[],
  matchedRoles: string[],
  matchedPermissions: string[],
  matchedScopes: string[],
  policyIds: string[]
}
```

The response must never expose information from another tenant.

---

# 41. Authorization Middleware

All protected application routes must use centralized authorization.

Conceptually:

```text
Request
  ↓
Authentication
  ↓
Tenant Resolution
  ↓
Membership Validation
  ↓
requirePermission(...)
  ↓
Scope Validation
  ↓
Policy Validation
  ↓
Handler
```

Do not implement isolated ad-hoc permission checks in individual pages.

---

# 42. UI Authorization

The UI may hide unavailable actions, but UI hiding is not security.

Example:

```text
[ + Add User ]
```

may be hidden from a user without:

```text
users.create
```

But the backend must independently reject:

```text
POST /api/users
```

for that user.

---

# 43. API Examples

Create user:

```text
POST
https://acme.Base App URL/api/v1/users
```

Required permission:

```text
users.create
```

Assign role:

```text
POST
https://acme.Base App URL/api/v1/users/{userId}/roles
```

Required permission:

```text
roles.assign
```

Create custom role:

```text
POST
https://acme.Base App URL/api/v1/roles
```

Required permission:

```text
roles.create
```

View effective permissions:

```text
GET
https://acme.Base App URL/api/v1/users/{userId}/effective-permissions
```

Required permission:

```text
users.view
```

---

# 44. Error Handling

Do not leak authorization information across tenants.

For unauthorized resource access, use a safe response such as:

```text
403 Forbidden
```

or, where resource existence must remain hidden:

```text
404 Not Found
```

Do not return:

```text
This resource belongs to another tenant.
```

---

# 45. UX Design Principles

Use the WonderID enterprise security-console design language:

- Light theme.
- White cards.
- Soft gray/blue background.
- Blue primary accent.
- Compact information density.
- Persistent tenant context.
- Persistent administration navigation.
- Clear breadcrumbs.
- Search-first interfaces.
- Tables for inventory.
- Side panels/drawers for details where useful.
- Multi-step wizards for complex configuration.
- Status badges.
- Permission summaries.
- Strong visual distinction between system and custom roles.
- Clear destructive-action treatment.

Avoid:

- Dark security-console theme unless explicitly requested.
- Excessive gradients.
- Heavy shadows.
- Decorative UI that reduces information density.
- Ambiguous permission names.

---

# 46. Navigation

Recommended:

```text
WONDERID

Overview

DISCOVER
  Discovery
  AI Inventory
  NHI Inventory
  Shadow AI
  MCP & Tools
  Models
  Applications
  Data Sources

UNDERSTAND
  Agents
  Access Intelligence
  Access Graph
  Delegation
  Effective Access

GOVERN
  Registration
  Ownership
  Lifecycle
  Policies
  Approvals
  Certifications
  Exceptions

PROTECT
  Runtime Gateway
  Authorization
  Tool & MCP Control
  JIT & Credentials
  Data Protection
  Emergency Controls

ASSURE
  Runtime Activity
  Risk
  Findings
  Investigations
  Behavioral Security
  Evidence
  Audit

INTEGRATIONS

ADMINISTRATION
  Users
  Groups
  Roles
  Permissions
  Authentication
  Security
  Audit
```

Administration is tenant-scoped.

---

# 47. Tenant Context UI

The top/side navigation must clearly show:

```text
ACME Corporation
Production
```

and:

```text
https://acme.Base App URL
```

Users should never be uncertain which tenant they are operating in.

---

# 48. Role Assignment UX

When assigning a role, show:

```text
Role
Scope
Permissions
Conditions
Source
Expiration
```

Example:

```text
Security Administrator

Scope:
Production

Permissions:
124

Conditions:
MFA required

Source:
Direct Assignment

Expiration:
Never
```

---

# 49. Effective Access UX

The user detail screen should provide:

```text
Assigned Roles
        ↓
Group Memberships
        ↓
Permission Sources
        ↓
Effective Permissions
```

Example:

```text
Effective Permissions: 247

agents.view
  └── Security Administrator

governance.approve
  └── Compliance Reviewer

audit.export
  └── Security Administrator
```

This is important for troubleshooting access.

---

# 50. Authorization Explainability

Every denied action should have a useful explanation.

Example:

```text
Access denied

You do not have permission to publish runtime policies.

Required:
runtime_policies.publish

Your roles:
Security Analyst

Your permissions:
runtime.view
runtime_policies.view

Missing:
runtime_policies.publish
```

Do not expose internal security details that would create cross-tenant leakage.

---

# 51. Security-Critical Administrative Controls

The following actions should require elevated permissions and strong audit:

```text
Change SSO
Change MFA requirements
Change tenant security policies
Create Tenant Administrator
Assign Tenant Administrator
Create privileged role
Assign privileged role
Publish runtime policy
Disable runtime controls
Use kill switch
Export sensitive evidence
Change audit retention
```

---

# 52. Admin Role Governance

A Tenant Administrator can:

```text
Create users
Invite users
Assign roles
Create groups
Assign groups
Create custom roles
Review effective access
Suspend users
Run access reviews
```

But sensitive operations may still require additional permission or approval.

Example:

```text
Tenant Administrator
        +
roles.manage
        +
Independent approval
```

for particularly privileged operations.

---

# 53. Initial System Roles

The initial release should contain:

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

The exact permission mapping should be stored in the permission catalog and covered by automated tests.

---

# 54. P0 Acceptance Criteria

The feature is P0 complete when:

### Tenant

- Tenant has unique URL.
- Tenant hostname resolves correctly.
- Tenant context is server-side.
- Tenant isolation works.
- Suspended tenants cannot authenticate.

### Users

- Admin can invite users.
- Admin can activate/suspend users.
- Multiple users can coexist.
- User membership is tenant-scoped.

### Roles

- Multiple roles can be assigned.
- Built-in roles work.
- Custom roles can be created.
- System roles cannot be modified.
- Roles can be assigned by authorized administrators.

### Permissions

- Permissions are granular.
- Permission catalog is centralized.
- Permission checks happen server-side.
- UI respects permissions.
- APIs enforce permissions.

### Groups

- Groups can be created.
- Users can be added/removed.
- Groups can receive roles.
- Group-derived permissions work.

### Scope

- Tenant scope works.
- Environment scope foundation works.
- Resource scope architecture exists.
- Scope is enforced server-side.

### Security

- Cross-tenant access is denied.
- RLS protects tenant data.
- Self-privilege escalation is prevented.
- Last-administrator lockout is prevented.
- Privileged actions are audited.

---

# 55. P1 Acceptance Criteria

P1 should add:

```text
Custom domains
Advanced scopes
Attribute-based authorization
Delegated administration
Temporary roles
Break-glass access
JIT administration
Step-up authentication
SCIM
Advanced access certification
Access request workflow
Dynamic policies
```

---

# 56. P2 Acceptance Criteria

P2 may add:

```text
Role mining
Entitlement mining
AI role recommendations
Access optimization
Policy simulation
What-if authorization
Predictive access risk
Automated least privilege
Automated remediation
```

AI recommendations must never bypass deterministic authorization.

---

# 57. Testing Requirements

## Unit Tests

Test:

```text
permission matching
role resolution
group resolution
scope evaluation
condition evaluation
deny precedence
role inheritance
membership status
tenant resolution
```

## Integration Tests

Test:

```text
Create tenant
Create user
Invite user
Assign role
Create group
Assign group role
Create custom role
Assign scope
Evaluate access
Suspend user
Revoke role
```

## Security Tests

Mandatory:

```text
Cross-tenant access
IDOR
Privilege escalation
Role escalation
Self-assignment
Last-admin removal
Suspended-user access
Expired-role access
RLS bypass
API authorization bypass
UI/API mismatch
```

## E2E Tests

Example:

```text
Create tenant
   ↓
Open https://acme.Base App URL
   ↓
Login as Tenant Administrator
   ↓
Create Anita
   ↓
Assign Compliance Reviewer
   ↓
Create custom role
   ↓
Assign role to Anita
   ↓
Login as Anita
   ↓
Verify allowed screens
   ↓
Verify denied actions
```

---

# 58. Recommended Implementation Sequence

```text
Phase 1
Tenant
Tenant URL
Tenant Resolution
Tenant Membership
RLS

Phase 2
Users
Invitations
User Lifecycle

Phase 3
Permission Catalog
System Roles
Role Assignments

Phase 4
Groups
Group Roles
Effective Permissions

Phase 5
Scopes
Conditions
Authorization Engine

Phase 6
Custom Role Designer
Role Management UI

Phase 7
Authorization Explainability
Audit

Phase 8
Access Certification
Delegated Administration
Advanced Security
```

---

# 59. Final Authorization Architecture

```text
                    WONDERID
                       │
             ┌─────────┴─────────┐
             │                   │
       PLATFORM PLANE       TENANT PLANE
                                 │
              ┌──────────────────┼─────────────────┐
              │                  │                 │
           Tenant A           Tenant B          Tenant C
              │
     https://acme.Base App URL
              │
        Tenant Resolver
              │
        Authentication
              │
      Tenant Membership
              │
       ┌──────┴──────┐
       │             │
    Groups       Direct Roles
       │             │
       └──────┬──────┘
              │
            Roles
              │
         Permissions
              │
            Scope
              │
         Conditions
              │
       Security Policies
              │
      Authorization Engine
              │
       ┌──────┼──────────┐
       │      │          │
     ALLOW   DENY   REQUIRE_APPROVAL
       │
       ▼
 Resource Access
       │
       ▼
     Audit
```

---

# 60. Product Principle

WonderID should treat application access as a governed identity-security problem, not simply a user-management feature.

The final model is:

```text
One Organization
        ↓
One Dedicated Tenant
        ↓
One Tenant URL
        ↓
Many Users
        ↓
Groups + Roles
        ↓
Fine-Grained Permissions
        ↓
Scoped Access
        ↓
Policy-Based Authorization
        ↓
Auditable Decisions
```

The same authorization foundation must support the entire WonderID product:

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

The human-user permission model must remain separate from AI-agent runtime authorization while sharing common policy, identity, scope, audit and decision-engine primitives.

---

# 61. Claude Code Implementation Rules

When implementing this specification:

1. Inspect the existing WonderID repository before creating new architecture.
2. Reuse existing tenant, authentication, RBAC, audit and RLS primitives where they already exist.
3. Do not create duplicate authorization systems.
4. Do not create a separate permission model per module.
5. Preserve existing database conventions.
6. Preserve existing Supabase RLS patterns.
7. Every new tenant-owned table must be reviewed for `tenant_id`.
8. Every protected API must perform server-side authorization.
9. Never trust tenant IDs supplied only by the browser.
10. Never trust role/permission data supplied by the browser.
11. Never rely on hidden UI elements for security.
12. Add tests before marking authorization stories complete.
13. Add audit events for privileged changes.
14. Prevent self-privilege escalation.
15. Prevent removal of the final tenant administrator.
16. Ensure suspended users lose access.
17. Ensure cross-tenant resource access is impossible.
18. Keep authorization decisions deterministic.
19. Do not use an LLM as the sole security decision-maker.
20. Document all permission IDs and their owning product modules.
21. Keep system-role definitions version-controlled.
22. Make custom-role definitions tenant-owned.
23. Make effective-permission explanations traceable to role/group/scope sources.
24. Add feature flags where a capability is not yet production-ready.
25. Update tests, audit events, API documentation and UI together when permission semantics change.

---

# 62. Definition of Done

This feature is complete only when a real tenant administrator can:

```text
Create tenant
   ↓
Open https://<tenant-slug>.Base App URL
   ↓
Authenticate
   ↓
Invite multiple users
   ↓
Create groups
   ↓
Assign users to groups
   ↓
Assign built-in roles
   ↓
Create custom roles
   ↓
Select granular permissions
   ↓
Define scope
   ↓
Review effective access
   ↓
Create / activate users
   ↓
Users can access only authorized functionality
   ↓
Unauthorized actions are denied server-side
   ↓
Every privileged change is audited
   ↓
Access can later be reviewed and certified
```

This is the required foundation for multi-organization WonderID deployment.
