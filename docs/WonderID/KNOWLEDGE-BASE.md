# WonderID knowledge base

## Contents

1. [What WonderID is](#1-what-wonderid-is)
2. [Signing in and getting around](#2-signing-in-and-getting-around)
3. [Identities](#3-identities)
4. [AI agents](#4-ai-agents)
5. [Connecting your systems](#5-connecting-your-systems)
6. [Applications, accounts and access](#6-applications-accounts-and-access)
7. [Requesting access](#7-requesting-access)
8. [Making the change: by a person or automatically](#8-making-the-change-by-a-person-or-automatically)
9. [Risk and findings](#9-risk-and-findings)
10. [Reviews, policies and compliance](#10-reviews-policies-and-compliance)
11. [Users, roles and permissions](#11-users-roles-and-permissions)
12. [Audit, reports, notifications and search](#12-audit-reports-notifications-and-search)
13. [Privacy](#13-privacy)
14. [Billing](#14-billing)
15. [Organization settings](#15-organization-settings)
16. [Vendor administration](#16-vendor-administration)
17. [Safety and trust](#17-safety-and-trust)
18. [Coming soon](#18-coming-soon)

[Revision history](#revision-history) is below.

**Last updated:** 12 October 2026

A plain-language guide to what WonderID does, how its parts fit together and where to find each feature. It is kept current as the product changes.

---

## Revision history

| Date | What changed |
|---|---|
| 13 Sep 2026 | First version of the product: organizations, sign-in, roles and permissions, and AI agent identities with owners, lifecycle and approved purpose. |
| 14 Sep 2026 | Connections to other systems, effective access and policies, runtime activity, risk scoring and rogue-agent detection, access reviews, audit trail, reports, notifications, search, and the vendor administration console. Single sign-on and two-step verification. |
| 15 Sep 2026 | New visual design; agent discovery became a full detect, review and register flow. |
| 16 Sep 2026 | AI summaries (OpenAI or Gemini, your own key optional), email notifications, the governance evidence pack as a PDF, governance drift and posture, scheduled review escalation. |
| 17 Sep 2026 | Public website, redesigned screens, forgot-password, tables that turn into cards on phones. |
| 18 Sep 2026 | Faster pages, Google sign-in, the help centre with an ask-the-guide assistant, the real logo. |
| 19 Sep 2026 | More global search results, more notification triggers, an extra risk factor for privileged access. |
| 25 Sep 2026 | Light console design; per-agent API keys; the Runtime Gateway with emergency stop and tool filtering; inventories of non-human identities, shadow AI, MCP servers and data sources; investigations; separation-of-duties checks; policy drafts and publishing. |
| 25 Sep 2026 | The product became **WonderID**: one directory for every kind of identity, not only AI agents. |
| 26 Sep 2026 | Identity sources and matching, joiner/mover/leaver with ownership transfer, the application catalog and onboarding, accounts inventory, application discovery, the request catalog, approvals and access packages, organization addresses and branding, users, roles, groups and scoped permissions. |
| 1 Oct 2026 | Billing (Stripe and Razorpay), privacy tools (GDPR, DPDP), a tamper-evident audit trail, financial and privacy control frameworks, security hardening. |
| 2 Oct 2026 | Microsoft and LinkedIn sign-in; single sign-on creates members only after a real single sign-on. |
| 9 Oct 2026 | Help centre checked against the product; pricing on the website. |
| 10 Oct 2026 | The connection framework with built-in connectors; CSV import and export on every list; install on phones and tablets; the "why does this person have access" ledger; a separate Admin menu; Global Configuration. |
| 11 Oct 2026 | Detecting what was removed in a connected system; automatic flow after every sync; access imported from connected systems and labelled approved, legacy, unproven or rogue; service accounts and agents as owned identities; access requests that end verified, with tasks for application owners; time-bound access; one inbox; bulk invitations. |
| 12 Oct 2026 | Automation credentials for your own tools; connected systems that make approved changes themselves; removing rogue access through a request; a limit on mass changes; richer connection types; faster scheduled syncs that read only what changed. |
| 12 Oct 2026 | This guide rewritten to cover the whole product. |
| 12 Oct 2026 | Every rogue account gets a ticket number (RA-000001, …), one per account, that closes once the account is fixed. |
| 12 Oct 2026 | Connections can sign in with a private key instead of a shared secret, or with a client certificate. |

---

## 1. What WonderID is

WonderID is an identity governance and security platform. For every identity in your organization, it answers:

- **Who or what is it?** A person, a contractor, a service account, a machine, an application or an AI agent.
- **What can it access?**
- **Why does it have that access?** Who approved it, and under which rule.
- **Is that access still right?**

The everyday cycle looks like this:

```text
 Connect a system ─▶ Import accounts and access ─▶ Check each piece of access
        ▲                                                     │
        │                                                     ▼
 Verify by reading ◀─ Make the change ◀─ Approve ◀─ Request (or flag what's wrong)
 the system again     (person or connector)
```

**Two principles hold everywhere:**
- **Nothing counts until it is verified.** A change counts as done only after WonderID reads the system again and sees it.
- **People decide.** Every change to someone's access is approved by a person. Automation and AI only carry out or suggest; they never decide.

**What WonderID is not:**
- It is not your sign-in provider, HR system, password vault or security monitoring tool.
- It works alongside those systems and keeps a record of where each piece of information came from.

---

## 2. Signing in and getting around

**Signing in**
- **Ways to sign in:** email and password, Google, Microsoft, LinkedIn, or your organization's single sign-on (SSO).
- **Two-step verification:** add an authenticator app in Settings → Security.
- **Forgotten password:** use "Forgot password" on the sign-in page.
- **Methods not set up:** a sign-in method your organization hasn't set up shows as unavailable.

**Organizations**
- Each organization's data is completely separate from every other organization's.
- You may belong to more than one organization.
- Each organization can have its own web address and logo.

**Navigation**
- **Main menu:** starts at Home, then My Access and the areas you work in.
- **Admin menu:** organization administration has its own menu. Open it with **Admin** at the bottom of the main menu, and use the back button to return to Home.
- **What you see:** each menu lists only the pages your permissions allow.

**Everywhere**
- **Search:** global search finds identities, agents, applications, findings, requests and more.
- **Notifications:** in the app, and by email if you choose.
- **On phones and tablets:** WonderID can be installed like an app, and every screen works at phone size.
- **Light and dark mode:** both are supported.
- **Help centre:** open to anyone, no sign-in needed. It has a user guide, an FAQ and an assistant that answers questions from the guide.

---

## 3. Identities

**One directory for every identity:** people (employees and contractors), external users, service accounts, machines, workloads, applications, APIs and AI agents.
- **Where:** Admin → Identity Repository → Identities.

**Owners**
- Every non-human identity, such as a service account or an AI agent, has a responsible person.
- **Unowned identities:** a service account found in a connected system that belongs to no one waits in **Onboarding → Unowned Identities** until someone assigns an owner.
- **No owner, no requests:** nobody can request access for an identity without an owner.

**Joiners, movers and leavers**
- When someone joins, changes role or leaves, WonderID creates the work that follows: tasks for the right people, and ownership handed over.
- When a person leaves, what they owned is transferred to someone else, never left without an owner.

**Identity sources**
- An HR system or directory can be the source of people's details.
- **Matching:** WonderID matches each record to the right identity using fixed rules: an id first, then an employee number, then a verified email. Unclear matches wait in **Pending Matches** for a person to decide.
- **Which source wins:** you choose which source owns which detail.
- **Custom details:** your own fields, such as cost centre, can be filled from a source. Each value is checked and WonderID records which source set it.

**Duplicates**
- Possible duplicates are flagged for review and merged only after a person agrees.

---

## 4. AI agents

AI agents are governed like any other identity. They also get controls designed for software that acts on its own.

**Approved purpose, actual access and observed behaviour**

For every agent, WonderID compares three things:
- **Approved (SHOULD):** what the agent is approved to do, from its contract: purpose, owner, approved applications, data and actions.
- **Effective access (CAN):** what it is technically able to do, worked out from its real permissions.
- **Observed (DID):** what it has actually done, from its runtime activity.

A gap between them, such as access the agent shouldn't have or something it did that wasn't approved, becomes a finding.

**Agent 360**
- One page per agent: its contract, owner, lifecycle state, access, activity, risk and findings.

**Discovery and shadow AI**
- WonderID finds agents and AI tools that were never registered.
- You review what it found and register it, or dismiss it.

**The Runtime Gateway**
- **What it is:** agents can send each action through the gateway before taking it.
- **Two modes:**
  - *Observe:* records the action.
  - *Enforce:* allows or blocks the action against the agent's contract and access. Each organization chooses the mode.
- **Emergency controls:** suspend an agent at once, or block specific tools.
- **API keys:** each agent can have its own API key for the gateway.

**Inventories**
- MCP servers, their tools (classified as read or write) and resources.
- The data sources agents can reach.
- Non-human identities and their credentials (for ownership, rotation and expiry; WonderID never stores the secret itself).

---

## 5. Connecting your systems

All information from your systems reaches WonderID through **connections**. There is no other path in or out.

**Connection types and connections**
- **Connection type:** describes one product's interface, for example Keycloak, an LDAP directory or Kubernetes.
- **Connection:** your organization's link to that product, with its address, its credentials (stored encrypted, shown masked) and a sync schedule.
- **Where:** Admin → Integrations.

**Built-in connection types**

| Kind of system | Built-in types |
|---|---|
| HR | Frappe HR |
| Directories and identity providers | LDAP directory, Keycloak, Saviynt |
| Applications | ERPNext, Gitea, Mattermost, Nextcloud, Zendesk |
| Infrastructure and data | PostgreSQL, Kubernetes, OpenBao (secrets) |
| AI | MCP server, Runtime Gateway |
| Anything else | Webhook (signed events from any system), CSV files |

**Your own connection types**
- An integrator can describe any system with an HTTP, LDAP, SQL, MCP or file interface: no code, just a definition.
- **Checked as you type:** the editor checks the definition and can try it against the real system before saving.
- **Cleaning up values:** values can be changed into the form WonderID needs. For example: make text lowercase, look values up in a table, pick out part of a value with a pattern, replace text, fall back to another field, or shift a date.
- **Sign-in styles for the system:** none, basic, bearer token, API key (in a header, the address or the request body), OAuth client credentials, LDAP bind and database user.
  - **With a private key instead of a shared secret:** for OAuth, the connection signs a short-lived token with your organization's private key (the style service accounts use). The key is stored encrypted and never shown or logged.
  - **With a client certificate:** for systems that require one (mutual TLS). The certificate is only ever presented to that connection's own secure address.

**Syncing**
- **Schedule:** each connection syncs on a schedule, or on demand with "Sync now".
- **What happens after a sync:** WonderID updates identities, then accounts, then access, without anyone pressing a button. Each step shows its progress and counts on the connection's page.
- **Faster scheduled syncs:** a connection type can say how to ask for **only what changed** since the last good sync. Scheduled syncs then read just the changes. A full read still happens at least once a day, so deletions are noticed.

**Noticing removals**
- When something disappears from a system, such as an account deleted or a person who left, a full sync marks it "missing at the source". Nothing is deleted, so the history stays.
- **Mass-missing guard:** if a sync would suddenly mark a large share as missing (more than 20% by default), it is held until a person approves or discards it. A broken file can't wipe out your data.

**Files**
- Every list in WonderID has **Import** and **Export**.
- **Import:** CSV files are previewed first, then new records are added and existing ones updated.
- **Bulk invitations:** Users → Import CSV.

**The Connector Gateway**
- Every call to or from your systems passes through one gateway.
- It blocks calls to internal or unexpected addresses and limits the request rate.
- It also counts usage.

---

## 6. Applications, accounts and access

**Application catalog**
- Every governed system has an owner, a risk level and a data classification.
- **Application discovery:** applications found in connected systems but not yet in the catalog are listed for review.

**Onboarding an application**
1. **Configure:** choose its connection and how its accounts match identities.
2. **Validate:** WonderID checks the configuration.
3. **Simulate:** see what it would import before anything changes.
4. **Approve:** a second person approves.
5. **Promote:** the configuration goes live.

An AI assistant can **propose** an onboarding configuration; a person always reviews and approves it.

**Accounts**
- Each account is matched to its identity.
- Accounts are flagged when:
  - they match no one (*orphan*);
  - they match more than one identity (*ambiguous*);
  - they haven't been used for a set time (*dormant*).

**Entitlements and access**
- Each system's permissions (groups, roles) and who holds them are imported.
- You can preview the changes, then apply exactly what you saw.

**Every piece of access is labelled:**

| Label | Meaning |
|---|---|
| **Approved** | WonderID has the request or decision behind it |
| **Legacy** | It was already there when the application was first connected |
| **Unproven** | Not yet checked |
| **Rogue** | It appeared later with no approval; this raises a finding |

**The access ledger**
- Answers "why does this identity have this access?": where it came from, who approved it and when.
- Each access also shows when the system last confirmed it.
- Every record shows where its information came from.

---

## 7. Requesting access

**The request catalog**
- Ask for access to an application or a specific permission, with a reason.
- You can also ask to **remove access**, **create an account** or **disable an account**.

**Who you can request for**
- **Yourself:** yes.
- **People you manage:** yes.
- **A service account you own:** yes.
- **An AI agent you are the business owner of:** yes, but only what its approved contract allows; anything else is refused.

**Request policies and approvals**
- Each application or permission can have its own policy, covering:
  - who approves, in which order;
  - whether low-risk requests are approved automatically;
  - how long access may last;
  - whether a reason is required.
- Nobody can approve their own request.
- Separation-of-duties rules can block a request that would give a conflicting combination of access.

**Access packages**
- Bundles of access that are commonly needed together, requested in one go.

**Time-bound access**
- Access can have an end date.
- You are reminded before it ends and can ask to extend it.
- At the end date the access is removed and recorded as expired.

**Tracking**
- **Access Requests:** shows where each request really stands:

  ```text
  waiting for approval ─▶ waiting for fulfilment ─▶ not yet verified ─▶ verified
  ```

  It may also show failed or ended.
- **"Waiting for you":** brings together the approvals and tasks that need you.

---

## 8. Making the change: by a person or automatically

An approved request is not access yet. It becomes access once the change is made in the system and WonderID sees it there.

**By a person: fulfilment tasks**
- **Where tasks go:** each approved change opens a task for the application's owner, who is notified.
- **Working a task:** the owner claims it, makes the change in the system, and marks it done or failed (with a reason).
- **Deadlines:** tasks are due within a set time (3 days by default) and send a daily reminder when overdue.
- **Closing:** a task closes itself when the next sync confirms the change.
- **Where:** Access Governance → Fulfilment Tasks.

**Automatically: connections that make the change themselves**
- **What they can do:** a connection can carry out approved changes:
  - remove access;
  - disable accounts;
  - add access;
  - create accounts.
- **Off until switched on:** this is off until an administrator turns it on for that connection (the connection's page → "Changes in the system"), and only for the changes its type supports.
- **No account yet:** for someone with no account, the connection creates the account first, then adds the access once the account appears.
- **Never applied twice:** each attempt carries a unique key, so a system never applies the same change twice.
- **Temporary errors:** these are retried twice.
- **Verified:** after the change, WonderID reads the system again and marks it verified only if the change is really there.
- **If it fails:** the task goes back to its owner with the reason. They can do it by hand or press "Try again".

**Limit on mass changes**
- A connection may make at most 100 changes an hour by default. You can change this in Global Configuration → Connections.
- Past the limit, nothing more is sent and the extra changes become tasks for people.

**Automation credentials**
- Your own tools, such as pipelines or ticketing systems, can call WonderID's API with their own credential instead of a person's login.
- **Ownership and approval:** each credential belongs to an application identity and needs a second administrator to approve it.
- **Limits:** it expires within a year, can be limited to certain network addresses, and is rate-limited.
- **The secret:** it is shown once. Only a fingerprint of it is kept.
- **Audit:** every call is audited.
- **Where:** Settings → Automation Credentials.

---

## 9. Risk and findings

**Risk scoring**
- Every agent and identity gets a risk score from fixed, explainable rules, never from AI alone.
- Weights are configurable.

**Findings**
Findings are raised for:
- access beyond the approved purpose;
- unauthorized actions;
- sensitive-data use;
- behaviour that drifts from normal;
- missing owners or lifecycle problems;
- rogue agents;
- rogue access.

**Rogue access**
- **Raising:** access that appeared in a system with no approval raises a finding.
- **One ticket per account:** a rogue account gets one ticket, such as **RA-000012**, numbered in order within your organization. Everything rogue found on that account belongs to the same ticket. You can quote the number in conversations and other tools; it shows on the account page and in Risk Overview.
- **Fixing:** for each piece of rogue access, a reviewer clicks **Remove access**, which raises an ordinary request under the application's rules. The request quotes the account's ticket number.
- **Closing:** the ticket stays open until all of the account's rogue access is dealt with (removed, and confirmed by the next sync, or approved after all). Then it closes as "verified fixed". If rogue access turns up on the same account later, a new ticket opens.

**Investigations**
- Group findings and evidence into a case and work it to a conclusion.
- AI can help summarise; a person concludes.

**Governance drift**
- Flags agents whose contract, ownership or access has drifted from what was approved.

**Where:** Intelligence → Risk Overview.

---

## 10. Reviews, policies and compliance

**Access reviews (certifications)**
- **Campaigns:** each campaign covers a chosen set of identities, applications or agents.
- **Decisions:** reviewers keep, revoke or change each piece of access.
- **Overdue items:** escalated automatically.
- **Evidence:** each decision is captured as evidence.
- **Who can review:** reviewers can't review their own access.

**Policies**
- Access and agent policies have targets and a priority.
- They move from **draft** to **published**, and every version is kept.

**Separation of duties**
- Define combinations of access that one identity must not hold.
- **Preventive:** conflicts can block requests.
- **Detective:** the Control Center reports conflicts that already exist.

**Compliance**
- **Control frameworks:** controls are mapped to SOX ITGC, SOC 1, PCI DSS, GLBA, DORA, RBI, SEBI CSCRF, CERT-In, GDPR and DPDP.
- **Governance posture and attestation:** show how well the organization is meeting its controls.
- **Governance evidence pack:** download it as a PDF for auditors.
- **What this means:** WonderID gives your auditors evidence; it never claims your organization *is* compliant.

---

## 11. Users, roles and permissions

**Users**
- **Inviting:** invite people one at a time or in bulk from a CSV (preview first).
- **Invitations:** they expire after 30 days and can be re-sent.

**Roles**
- Built-in and custom roles are made from a catalog of permissions.
- An invitation or role assignment can never give more than the person giving it holds.

**Groups**
- Assign roles to a group instead of each person.

**Scoped permissions**
- Give a permission for one application, one area or one kind of object, instead of the whole organization.

**Single sign-on**
- Connect your organization's identity provider.
- Members are created only after a real single sign-on.

**Where:** Admin → Users & Permissions.

---

## 12. Audit, reports, notifications and search

**Audit trail**
- Every security-relevant action is recorded: who, what, when, the outcome and related records.
- **Tamper-evident:** records can't be edited or deleted, and each one is chained to the one before.
- **Integrity check:** Audit → Integrity proves the chain is intact.

**Reports and exports**
- Ready-made governance reports, exported as files.

**Notifications**
- In the app and by email.
- Choose which ones you receive.

**Job status**
- Shows the progress of long-running work such as syncs and exports.

**Search**
- One search box across the whole product.

---

## 13. Privacy

**For members:** My Privacy shows your data, your consents and your requests.
- You can withdraw consent in one click.

**For administrators:** the privacy centre (Settings → Privacy) handles:
- **Requests:** access and erasure requests, with the legal deadlines built in (GDPR, UK GDPR, DPDP, CCPA).
- **Erasure:** needs two people, and never touches the audit trail.
- **Consent:** records of who agreed to what, with the notice version they saw.
- **Retention:** applied daily. Legal holds always win.
- **Breaches:** records with their notification deadlines.

---

## 14. Billing

- **Plans:** paid on the provider's own secure page: Stripe in USD and EUR, Razorpay in INR. WonderID never sees card or bank details.
- **Invoices:** numbered without gaps and never changed after they are issued.
- **Tax:** Indian GST is calculated automatically.
- **Plan changes:** they show only once the payment provider confirms them.
- **Refunds and overrides:** need a second person.

**Where:** Settings → Billing.

---

## 15. Organization settings

**Global Configuration**
- Organization-wide settings. Every change is saved as a new version.
- Settings include:
  - session length;
  - how long before an account counts as dormant;
  - how long fulfilment tasks have;
  - the mass-missing threshold;
  - the hourly limit on changes made by connections;
  - review defaults.

**AI provider**
- Choose OpenAI or Gemini, using WonderID's key or your own.
- AI is used for summaries and proposals. Its output is always labelled as AI-generated, and it never decides anything.

**Also here:** organization name, web address, branding and notification settings.

---

## 16. Vendor administration

These pages are for the WonderID service operator only, never for customers:
- **Organizations:** manage organizations and their subscriptions.
- **Feature flags.**
- **Usage and limits.**
- **Maintenance mode and announcements.**
- **Platform branding and health.**
- **Billing and refunds.**
- **Platform audit trail.**

---

## 17. Safety and trust

| Risk | What protects you |
|---|---|
| One organization seeing another's data | Every record carries its organization and the database itself refuses access across organizations; this is tested for every feature |
| A bad file or feed makes everything look deleted | The mass-missing guard holds the sync for a person to approve |
| A runaway rule or bad approvals change too much | At most 100 changes per connection per hour, by default |
| A change applied twice | Every attempt carries a unique key |
| "Done" without it really being done | Nothing is verified until WonderID reads the system again |
| A connection writing when it shouldn't | Changes are off until an administrator turns them on, and only for what the connection type supports |
| Someone approving their own access | Not allowed; key actions need a second person |
| AI making a decision | AI only suggests; fixed rules and people decide |
| Leaked passwords or keys | Secrets are encrypted, shown masked, never logged, and never sent to the browser |
| Tampering with the record | The audit trail is append-only and chained |

**Also built in:**
- strict browser security headers;
- protection against requests forged from other sites;
- a dependency vulnerability check on every change.

---

## 18. Coming soon

- **"Sign in with the provider" for connections:** OAuth authorization code, where an administrator approves the connection in the system's own sign-in page.
- **Sharing connection types:** export a connection type as a file, import it elsewhere, and upgrade a connection to a newer version with a preview of what changes.
- **Standard user provisioning:** SCIM, and changes through LDAP directories.
- **A relay** to reach systems inside your own network without opening it up.
- **Ready-made connections** for Microsoft Entra ID, an HR system (Workday or SuccessFactors) and ServiceNow ticketing.
- **Joiner, mover and leaver automation** with default ("birthright") access, and reviews for every identity type.
