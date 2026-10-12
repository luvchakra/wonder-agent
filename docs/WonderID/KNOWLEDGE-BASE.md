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
| 12 Oct 2026 | Connections can sign in with the provider: an administrator presses Connect and approves on the system's own sign-in page. |
| 12 Oct 2026 | Connection types can be downloaded and opened elsewhere, and a connection can move to a newer version after a preview; this guide was corrected where it promised more than the product does. |
| 12 Oct 2026 | Any application with a SCIM 2.0 service can be connected and make approved changes (add and remove group members, disable and create users); LDAP directories can add and remove group members. |
| 12 Oct 2026 | Stronger safeguards: emergency controls block in every gateway mode; high-risk access always needs a person; nobody approves their own request; automation credentials never approve or certify. |
| 12 Oct 2026 | A role given to an automation credential pauses it until a second administrator approves; owners are reminded about removals that the system has not confirmed. |
| 12 Oct 2026 | Ended access shows whether it is really gone; removing access and disabling accounts are due within a day; refused automation calls are audited, and the database caps automation credential expiry at a year. |
| 12 Oct 2026 | When someone leaves, each access they hold becomes its own removal task, due within a day; removals more than a day overdue go to the access managers. |
| 12 Oct 2026 | Identity providers and HR systems can push people to WonderID over SCIM 2.0 as they join, change and leave. |
| 12 Oct 2026 | Agents that act without asking the Runtime Gateway, or despite a "no", now get a gateway bypass finding. |
| 12 Oct 2026 | A sync cut short at a limit counts as partial, so the next sync still reads everything it missed. |
| 12 Oct 2026 | Rogue access that was approved later is recorded as "approved afterwards", with its request, never as fixed. |
| 12 Oct 2026 | An account matched to a person stays with them when an email address or username is reused; the sync results say so. |
| 12 Oct 2026 | A sync is held when every record of a kind would go missing at once, at any size; people are held at a lower share than other records. |
| 12 Oct 2026 | A connection's change sends the system one key however often it is tried; a change that may already have been made is checked by reading the system before it is sent again. |
| 12 Oct 2026 | A sync that reads fewer records than the system says it holds counts as partial and marks nothing missing. |
| 12 Oct 2026 | Audit records are kept at least a year on every plan: 1 year on Free and Pro, 3 years on Max, 7 years on Enterprise. |
| 12 Oct 2026 | When someone leaves, a connection that can disable accounts (with changes turned on) disables their account at once; people still remove each access. |
| 12 Oct 2026 | A "gateway only" setting per agent: acting around the gateway is critical and suspends the agent at the gateway. |
| 12 Oct 2026 | Rogue access on an account can be accepted as an exception (up to 90 days) or closed as a false positive, with a reason, by someone other than the account's owner. |
| 12 Oct 2026 | When two identity sources disagree on a detail, the higher-priority source still wins, and the disagreement is listed with both values and sources for review; it clears itself once they agree. |

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
- **People decide.** Access changes are approved by people. A request policy can approve low- and medium-risk requests automatically, recorded as such; high-risk access always needs a person. Automation credentials and AI never approve.

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
- When someone joins, changes role or leaves, WonderID creates the work that follows: tasks to hand over ownership and remove access. People do this work.
- When someone actually stops working (disabled, terminated or archived), each access they hold gets its own removal task on Fulfilment Tasks, marked "Person left" and due within a day. Access approved but never set up is withdrawn. Serving notice does not start this.
- A person makes each of these removals, even where a connection could; it counts as removed only when a later read of the system no longer finds it.
- Where a connection can disable accounts and has changes turned on, it disables the person's account there at once. The next read confirms it. If it fails, the application's owner gets the task with the reason.
- When a person leaves, what they owned is transferred to someone else, never left without an owner.

**Identity sources**
- An HR system or directory can be the source of people's details.
- **Matching:** a record keeps the identity the source already linked it to. Otherwise the source's rules are tried in order (email by default; username or a combination of fields can be added). One match links automatically; several, or a single match on someone who has left, wait in **Pending Matches** for a person to decide.
- **Which source wins:** you choose which source owns which detail, and each source's priority. When a lower-priority source sends a different value for a detail a higher one owns, the higher value stays; the disagreement is listed under **Pending Matches → Disagreements between sources**, with both values and both sources. It clears itself when the sources agree again.
- **Custom details:** your own fields, such as cost centre, can be filled from a source. Each value is checked and WonderID records which source set it.

**Duplicates**
- Possible duplicate AI agents are flagged for review and merged only after a person agrees. A merge cannot be undone.

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
- **What it is:** agents can ask the gateway before taking an action. Only actions sent to the gateway are checked; an agent that calls a system directly is not checked or stopped.
- **Bypass detection:** once an agent uses the gateway, any action WonderID sees from another source (MCP, a runtime or a webhook) without a gateway decision for it shortly before becomes a "gateway bypass" finding. So does an action that went ahead although the gateway said no. This finds a bypass after the fact; it does not stop it. Agents that never use the gateway are not judged.
- **Gateway only:** on an agent's page (API keys → "Gateway only"), someone with emergency-control permission can turn this on. Then a bypass by that agent is a critical finding, and the agent is suspended at the gateway at once: every call is refused, in every mode, until an administrator lifts the suspension on the Runtime page.
- **Two modes:**
  - *Observe* (the default): the decision is recorded and the agent is told to go ahead, except when an emergency control applies or no decision can be worked out: then it is told no.
  - *Enforce:* the agent is told to allow or block the action, against its contract and access. A platform administrator switches it on for an organization. If no decision can be worked out, the answer is block.
- **Emergency controls:** an organization-wide stop, or blocking a tool, an MCP server or a session. They block at once, in both modes. To stop one agent, suspend it.
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
| Directories and identity providers | LDAP directory (which can also add and remove group members), Keycloak, Saviynt, and any identity provider or HR system that pushes people over SCIM 2.0 |
| Applications | ERPNext, Gitea, Mattermost, Nextcloud, Zendesk, and any application with a SCIM 2.0 service (which can also add and remove group members, disable and create users) |
| Infrastructure and data | PostgreSQL, Kubernetes, OpenBao (secrets) |
| AI | MCP server, Runtime Gateway |
| Anything else | Webhook (signed events from any system), CSV files |

**Your own connection types**
- An integrator can describe any system with an HTTP, LDAP, SQL, MCP or file interface: no code, just a definition.
- **Checked as you type:** the editor checks the definition and can try it against the real system before saving.
- **Sharing and upgrading:** download a connection type as a file and open it in another organization's editor. When a newer version is published, a connection shows "available"; its preview lists what changes (settings, sign-in, what it reads and how fields are mapped) before you upgrade. An upgrade never allows more changes in the system than before, and the next sync reads everything again.
- **Cleaning up values:** values can be changed into the form WonderID needs. For example: make text lowercase, look values up in a table, pick out part of a value with a pattern, replace text, fall back to another field, or shift a date.
- **Sign-in styles for the system:** none, basic, bearer token, API key (in a header, the address or the request body), OAuth client credentials, LDAP bind and database user.
  - **With a private key instead of a shared secret:** for OAuth, the connection signs a short-lived token with your organization's private key (the style service accounts use). The key is stored encrypted and never shown or logged.
  - **With a client certificate:** for systems that require one (mutual TLS). The certificate is only ever presented to that connection's own secure address.
  - **Sign in with the provider:** an administrator presses **Connect** on the connection's page and approves on the system's own sign-in page. WonderID keeps the resulting sign-in encrypted and renews it by itself. If the sign-in is revoked, the connection asks to be connected again.

**Syncing**
- **Schedule:** each connection syncs on a schedule, or on demand with "Sync now".
- **What happens after a sync:** WonderID updates identities, then accounts, then access, without anyone pressing a button. Each step shows its progress and counts on the connection's page.
- **Faster scheduled syncs:** a connection type can say how to ask for **only what changed** since the last good sync. Scheduled syncs then read just the changes. If no full read has succeeded in the last day, the next scheduled sync reads in full. Records are marked missing only when every record of that kind was read.
- **Cut-short runs:** a sync whose read stopped at a limit counts as partial and says why. It never moves the starting point of the next read of only the changes, and never counts as the day's full read.
- **Counted reads:** when a system says how many records it holds (SCIM always does; other connection types can declare where), a read that brings back fewer counts as partial too, and nothing is marked missing.

**Noticing removals**
- When something disappears from a system, such as an account deleted or a person who left, a full sync marks it "missing at the source". Nothing is deleted, so the history stays.
- **Mass-missing guard:** if a sync would suddenly mark a large share as missing, it is held until a person approves or discards it. A broken file can't wipe out your data.
  - Most kinds are held above 20% of a kind with 20 or more records, by default.
  - People are held above 10%, or the organization's setting if it is lower.
  - Any kind, at any size, is held when every record of it would go missing at once.

**People pushed to WonderID over SCIM**
- An identity provider or HR system that provisions users over SCIM 2.0 (for example Okta or Microsoft Entra ID) can send its people to WonderID as they join, change and leave.
- **Setting it up:**
  1. Create a connection of the type "SCIM 2.0 provisioning (incoming)" and issue its secret.
  2. Enter the connection's SCIM address and secret in the system's provisioning settings.
  3. Add an identity source that reads the connection.
- **What happens:** each user the system creates, changes, deactivates or deletes is kept on the connection first. The identity source then takes it in, with its own mappings, matching and the fields it owns.
  - For the person's id, map `normalized.externalId`: that is the id WonderID gave the user. The system's own id stays in the record as `externalId`.
- **Leavers:** a deleted user is marked missing, never erased, and the source treats them as a leaver, under its leaver guard.
- **Groups:** groups pushed over SCIM are not received yet.

**Files**
- Every list in WonderID has **Import** and **Export**.
- **Import:** CSV files are previewed first, then new records are added and existing ones updated.
- **Bulk invitations:** Users → Import CSV.

**The Connector Gateway**
- Every call to or from your systems passes through one gateway.
- It blocks calls to internal or unexpected addresses, for every organization, and limits the request rate. A connection's credentials are not sent when a system redirects elsewhere.
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
- **Once matched, an account stays with its person.** If a later sync would match it to someone else (for example, an email address given to a new person), the account keeps its person. The connection's sync results count it as "kept with their person"; relink it by hand if it really changed hands.
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
| **Unproven** | No WonderID approval found, and it can't yet be called legacy or rogue (no baseline yet, or not reported by a connection) |
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
- Nobody can approve a request they made, or one that is for them.
- A request policy can approve low- and medium-risk requests automatically; these are recorded as approved automatically. High-risk requests always wait for a person.
- Separation-of-duties rules can block a request that would give a conflicting combination of access.

**Access packages**
- Bundles of access that are commonly needed together, requested in one go.

**Time-bound access**
- Access can have an end date.
- You are reminded before it ends and can ask to extend it.
- At the end date the access is no longer approved. WonderID opens a task to remove it, due within a day, and counts it as removed only when a later read of the system no longer finds it.
- The request shows where that stands: "Ended · removal pending", "Ended · removed, not yet verified" or "Ended · removal verified".

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
- **One key per change:** every try at the same change sends the system the same key, so a system that supports these keys makes the change once.
- **Temporary errors:** a rate limit, or a system that could not be reached, is retried twice.
- **Unclear outcome:** after a timeout, a dropped connection or a server error, the system may have made the change anyway.
  - If the connection type marks the change as repeatable (sending it twice can't make it twice), it is retried twice.
  - Otherwise it is not sent again. WonderID reads the system: if the change is there, the task closes by itself. "Try again" works only once that read has finished.
  - Directory (LDAP) changes are always repeatable. For SCIM, adding, removing and disabling are repeatable; creating a user is not.
- **Verified:** after the change, WonderID reads the system again and marks it verified only if the change is really there.
- **If it fails:** the task goes back to its owner with the reason. They can do it by hand or press "Try again".
- **Not confirmed:** if a removal was marked done but the system still has not confirmed it 2 days later, its owner is reminded daily to check.
- **Escalated:** a removal or account disable more than a day overdue goes to the organization's access managers, once.

**Limit on mass changes**
- A connection may make at most 100 changes an hour by default. You can change this in Global Configuration → Connections.
- Past the limit, nothing more is sent and the extra changes become tasks for people.

**Automation credentials**
- Your own tools, such as pipelines or ticketing systems, can call WonderID's API with their own credential instead of a person's login.
- **Ownership and approval:** each credential belongs to an application identity and needs a second administrator to approve it. Giving it another role pauses it until a different administrator approves the change.
- **Limits:** it expires within a year (the database refuses anything longer), can be limited to certain network addresses, and is rate-limited.
- **The secret:** it is shown once. Only a fingerprint of it is kept.
- **What it can do:** only what its roles allow. It can never approve access, certify, approve an onboarding or manage automation credentials: those are people's decisions.
- **Audit:** every call it is allowed to make is audited. Refused calls are audited too, whether the credential is pending, revoked or expired, the address is not allowed, or it is over its rate limit. To keep the record readable, each reason is recorded at most once a minute per credential.
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
- **Other outcomes:** under **Other outcomes** on the account page, someone with risk-management permission, and never the account's owner, can instead:
  - accept it as an **exception** until a date at most 90 days away, with a reason. The finding reopens on that date, and the ticket stays open meanwhile;
  - close it as a **false positive**, with a reason. The same access is not flagged again.
  Both are kept on the finding and in the audit trail.
- **Closing:** the ticket stays open until all of the account's rogue access is dealt with. Each finding records how: **removed** (confirmed by a later sync), or **approved afterwards**, with the request that approved it attached. The access history keeps the earlier Rogue status either way. If rogue access turns up on the same account later, a new ticket opens.

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
- **Tamper-evident:** records can't be edited, and each one is chained to the one before. They are deleted only by your audit retention policy: oldest first, never the last 365 days, never under a legal hold.
- **How long by default:** 1 year on Free and Pro, 3 years on Max, 7 years on Enterprise. Never less than a year.
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
| A change applied twice | Every attempt carries a key that systems supporting it use to ignore repeats; changes are verified by reading the system again |
| "Done" without it really being done | Nothing is verified until WonderID reads the system again |
| A connection writing when it shouldn't | Changes are off until an administrator turns them on, and only for what the connection type supports |
| Someone approving their own access | Not allowed; key actions need a second person |
| AI making a decision | AI only suggests; fixed rules and people decide |
| Leaked passwords or keys | Secrets are encrypted, shown masked, never logged, and never sent to the browser |
| Tampering with the record | The audit trail can't be edited, is chained, and is purged only by retention policy |

**Also built in:**
- strict browser security headers;
- protection against requests forged from other sites;
- a dependency vulnerability check on every change.

---

## 18. Coming soon

- **Groups pushed over SCIM**, and standard security events (RFC 9967) from identity providers.
- **A relay** to reach systems inside your own network without opening it up.
- **Ready-made connections** for Microsoft Entra ID, an HR system (Workday or SuccessFactors) and ServiceNow ticketing.
- **Joiner, mover and leaver automation** with default ("birthright") access, and reviews for every identity type.
