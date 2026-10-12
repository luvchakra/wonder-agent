# What's new in WonderID

**Covers:** 11 October 2026 onwards · **Last updated:** 12 October 2026

This page explains, in plain language, what has been built since 11 October 2026, why it matters and where to find it. It follows the delivery plan
([`run-order/RUN-ORDER.md`](run-order/RUN-ORDER.md)), so the features are grouped by phase, in the order they fit together. Technical detail is in
the linked documents; you don't need it to follow this page.

It is updated in the same pull request as each new piece of work.

---

## The big picture

WonderID answers one question for every identity (a person, a service account, an AI agent):
**who has access to what, why, and is it still right?**

The work since 11 October closes that loop, end to end:

```text
 ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
 │ 1. CONNECT │──▶│ 2. IMPORT  │──▶│ 3. CHECK   │──▶│ 4. REQUEST │
 │ a system   │   │ accounts & │   │ is each    │   │ & APPROVE  │
 │            │   │ access     │   │ access OK? │   │ access     │
 └────────────┘   └────────────┘   └────────────┘   └─────┬──────┘
                                         ▲                │
                                         │                ▼
 ┌────────────┐   ┌────────────┐   ┌─────┴──────┐   ┌────────────┐
 │ 8. FIX     │◀──│ 7. FLAG    │   │ 6. VERIFY  │◀──│ 5. MAKE    │
 │ what is    │   │ what is    │   │ by reading │   │ THE CHANGE │
 │ wrong      │   │ wrong      │   │ it again   │   │ person or  │
 └────────────┘   └────────────┘   └────────────┘   │ connector  │
                                                    └────────────┘
```

| Phase | In one sentence | Status |
|---|---|---|
| **F1: Import and reconciliation** (steps 1 to 3) | WonderID knows who has what in each connected system, and notices when it changes. | ✅ Done |
| **F2: Access requests** (steps 4 to 6) | People ask for access; it is approved, added, and proven to be there. | ✅ Done |
| **F3: Provisioning** (steps 5 to 8, automatic) | Connected systems make approved changes themselves, safely, and rogue access is removed. | 🟡 Mostly done |

Two ideas run through everything:

- **Nothing counts until it is verified.** A change counts as done only once WonderID reads the system again and sees it. A click saying "done" is not enough.
- **People stay in charge.** Every change to someone's access is approved by a person first. Automation only carries out what was approved.

---

## Phase F1: Know who has what (import and reconciliation)

*Goal: connect a system, and WonderID reliably knows every account, every permission and who it belongs to.*

### Detects what was removed at the source
- **What it does:** when a person leaves the HR feed, or an account is deleted in an application, the next full sync marks it **"missing at the source"**. Nothing is deleted, so there is always a trail.
- **Safety net:** if a sync would suddenly mark a large share as missing (more than 20% by default), WonderID **holds** the sync and asks a person to approve or discard it. A broken file can't wipe out your data.
- **Where:** the connection's page, Sync jobs. The threshold is in Global Configuration → Connections.

### Data flows on automatically after every sync
- **What it does:** after a sync, WonderID updates identities, then accounts, then access, without anyone pressing a button. Each step's progress and counts show on the connection page.
- **Also:** schedules now work for every connection, and a schedule can be set over the API.

### Permissions and "who has what" come in from connected systems
- **What it does:** the system's permissions (groups, roles) and who holds them are imported for each onboarded application.
- **How it works:** you can **preview** the changes first, then apply exactly what you previewed.
- **Removed access:** access no longer in the system is marked missing, and restored if it reappears.

### Every piece of access is classified
- **What it does:** each account's access gets one of four labels:
  - **Approved:** WonderID has a request or decision behind it.
  - **Legacy:** it was already there when the application was first connected.
  - **Unproven:** it is not classified yet.
  - **Rogue:** it appeared later with no approval.
- **Why it matters:** rogue access raises a **Risk finding**, which shows in Risk Overview. The finding closes by itself when the access is approved or removed.
- **Where:** each account's page shows the label, source and any finding.

### Service accounts and AI agents become governed identities
- **What it does:** service, machine and API accounts that belong to no person become identities with an **owner**.
- **Accounts with no owner:** these wait in **Onboarding → Unowned Identities** until someone assigns one. Nobody can request access for an identity that has no owner.
- **AI agents:** an agent's account is linked to the agent by an identifier the agent declares, such as an OAuth client id.

### Your own identity attributes can be filled from a source
- **What it does:** custom identity attributes (for example "cost centre") can be filled from an HR or directory feed.
- **Checks:** each value is checked and typed, and WonderID records which source set it.

### A clearer reconciliation console
- **What it does:** shows when access was last reconciled, how many records each run marked missing, and when each access was last seen at the source.

### A tidier Admin menu
- **What it does:** Admin is organised into seven groups: Identity Repository, Applications, Policies, Integrations, Users & Permissions, Settings and Compliance. Every page keeps its address.

✅ **F1 exit test passed:** a person, a service account and an agent are imported and correlated correctly; removed access shows as missing; rogue access raises a finding; another organization sees none of it.

---

## Phase F2: Ask for access, get it, prove it (access requests)

*Goal: a request goes from "please" to "verified on the system", with a clear status at every step.*

### Approval turns into real, tracked work
- **What it does:** an approved request becomes a **pending grant**. It is not access yet: effective access and runtime decisions ignore it.
- **No account yet:** a placeholder account holds the request until the real one appears.
- **Verified:** the request is marked verified only once a sync finds the access in the system.

### Fulfilment tasks for application owners
- **What it does:** each approved change opens a **task** for the application's owner, who is notified. They can claim it, mark it done, or report it failed with a reason.
- **Deadlines:** tasks have a deadline (3 days by default) and send a daily reminder when overdue.
- **Closing:** tasks close themselves when the change is verified.
- **Where:** Access Governance → Fulfilment Tasks.

### More kinds of request
- **What it does:** besides "give me access", people can ask to **remove access**, **create an account** or **disable an account**. Each has its own approval and is verified the same way.

### Requests for service accounts and AI agents
- **What it does:** the owner of a service account can request access for it.
- **AI agents:** an agent's business owner can request access for it, but only what the agent's approved contract allows. The server refuses anything else.

### Time-bound access
- **What it does:** access can have an end date.
- **Before the end date:** people are reminded once and can ask for an extension, which is approved like any request.
- **At the end date:** a removal task opens automatically, and the access record shows "expired" once the removal is confirmed.

### One inbox, and honest status everywhere
- **What it does:** Access Requests shows where each line really stands: waiting for approval, waiting for fulfilment, not yet verified, verified, failed or ended.
- **Your inbox:** "Waiting for you" lists both your approvals and your tasks.
- **Who you can request for:** the "For" picker offers yourself, the people you manage, and what you own.

### Inviting many people at once
- **What it does:** Users → **Import CSV** previews new, existing and invalid rows, then invites only the new people.
- **Invitations:** they expire after 30 days and can be re-sent. An invitation can never give more permissions than the inviter has.
- **API:** the same is available over the API, with a dry run.

✅ **F2 exit test passed:** a person, a service account and an agent each go from request to verified. Removal and expiry end revoked, and nobody can approve their own request.

---

## Phase F3: Close the loop automatically (provisioning)

*Goal: the connected system makes the approved change itself, WonderID checks it worked, and rogue access gets removed.*

### Connectors make approved changes, but only when you switch it on
- **What it does:** a connection can now carry out approved changes in the system itself:
  - **remove access**;
  - **disable accounts**;
  - **add access**;
  - **create accounts**.
- **Off by default:** an administrator turns it on per connection (the connection's page → "Changes in the system"). Turning it off makes every change a person's task again.
- **Reliable:** each attempt carries a unique key so a system never applies the same change twice. Temporary errors are retried twice.
- **Verified:** after the change, WonderID reads the system again and marks it verified only if the change is really there.
- **If it fails:** the task goes back to its owner with the reason, and they can do it by hand or press "Try again".

### Creating an account, then adding the access
- **What it does:** for someone with no account yet, the connector **creates the account first**. Once the next read brings that account in, the connector **adds the access**, and both are verified.

### Removing rogue access
- **What it does:** on a rogue-access finding, a reviewer clicks **"Remove access"**. This raises an ordinary request under the application's approval rules.
- **Then:** once approved, the connector removes the access, WonderID verifies it, and the finding closes as "verified fixed".

### A limit on mass changes
- **What it does:** a connection may make at most **100 changes per hour** by default (Global Configuration → Connections).
- **Past the limit:** nothing more is sent. The extra changes go to people as ordinary tasks, so a mistake or a runaway rule can't change everything at once.

### Automation credentials for your own tools
- **What it does:** pipelines and ticketing tools (ITSM) can call WonderID's API with their own credential instead of a person's login. The credential belongs to an application identity.
- **Approval:** a second administrator must approve each credential.
- **Limits:** it expires within a year, can be limited to address ranges, and is rate-limited. Its secret is shown once and only a hash is kept.
- **Audit:** every call is audited.
- **Where:** Settings → Automation Credentials.

### Richer connection types for integrators *(in progress)*
- **New ways to clean up imported values:**
  - pick out part of a value with a pattern (`regex`);
  - replace text (`replace`);
  - fall back to another field (`coalesce`);
  - shift a date (`dateAdd`).
- **New sign-in style:** systems that expect their **API key inside the request body** are now supported.
- **Still to come:**
  - incremental syncs (only what changed);
  - more sign-in types (OAuth authorization code, JWT, certificates);
  - exporting and importing a connection type, and upgrading a connection to a newer version with a preview of what changes.

✅ **F3 exit test passed** (against a test system): rogue access is found, a reviewer asks for it to be removed, it is approved, the connector removes it, WonderID verifies it and the finding resolves.

---

## Safety nets at a glance

| Risk | What protects you |
|---|---|
| A bad file or feed makes everything look deleted | The mass-missing guard holds the sync for a person to approve |
| A runaway rule or bad approvals change too much | The mass-change guard: at most 100 changes per connection per hour |
| A change applied twice | Every attempt carries a unique key; the system sees each key once |
| "Done" without it really being done | Nothing is verified until WonderID reads the system again and sees it |
| A connection writing when it shouldn't | Writes are off until an administrator turns them on, and only for what the connection type declares |
| Someone approving their own access | Requesters can't approve their own requests; key admin actions need a second administrator |
| One organization seeing another's data | Every new table and feature is tested for organization isolation |

---

## What's next

| Next | What it adds | Waiting on |
|---|---|---|
| Finish richer connection types (INTEGRATION-P0-21) | Incremental syncs, more sign-in types, export/import and upgrades | Nothing; in progress |
| SCIM, plus LDAP and HTTP writes (INTEGRATION-P0-22) | Standard user provisioning to many SaaS apps and directories | Nothing |
| WonderID Relay (INTEGRATION-P0-23) | Reach systems inside your own network without opening it up | **Your decision D7** |
| Named connectors: Entra ID, HR, ServiceNow (INTEGRATION-P0-24 to 26) | Ready-made connections to these products | **Your decision D9** |
| F4: Lifecycle and certification | Joiner/mover/leaver automation and access reviews for every identity type | After F3 |

**Also waiting on you:**
- Configuring the Supabase SSO provider.
- Reviewing the `wonderapps_dashboard` role.

---

## Change log

| Date | Change | PR |
|---|---|---|
| 11 Oct | IGA plan, foundation design and delivery order | #65, #77, #78 |
| 11 Oct | Detect records removed at the source; mass-missing guard | #79 |
| 11 Oct | Automatic import chain after every sync | #80 |
| 11 Oct | Permissions and access imported from connectors | #81 |
| 11 Oct | Access classification and rogue-access findings | #82 |
| 11 Oct | Service accounts and agents as governed identities | #83 |
| 11 Oct | Reconciliation console details | #84 |
| 11 Oct | F1 test suite (exit test passed) | #85 |
| 11 Oct | Custom attributes from sources; a schedule on every connection | #86 |
| 11 Oct | Admin menu in seven groups; rogue access in Risk Overview | #87 |
| 11 Oct | Approved requests become pending grants, verified by reconciliation | #88 |
| 11 Oct | Fulfilment tasks | #89 |
| 11 Oct | Remove-access and account requests | #90 |
| 11 Oct | Requests for service accounts and agents | #91 |
| 12 Oct | Time-bound access | #92 |
| 12 Oct | Request tracking and one inbox | #93 |
| 12 Oct | F2 test suite (exit test passed) | #94 |
| 12 Oct | Bulk invitations | #95 |
| 12 Oct | Automation credentials | #96 |
| 12 Oct | Connectors remove access and disable accounts | #97 |
| 12 Oct | Remove rogue access through a request (F3 exit test) | #98 |
| 12 Oct | Connectors add access and create accounts | #99 |
| 12 Oct | Mass-change guard and provisioning safety tests | #100 |
| 12 Oct | Richer connection types, part 1: four transforms, API key in the body | in review |

---

*For the technical detail behind each item:*
- *the design: [`design/DESIGN.md`](design/DESIGN.md);*
- *live story status: [`progress/PROGRESS.md`](progress/PROGRESS.md);*
- *connector reference: [`../integrations/CONNECTOR-FRAMEWORK.md`](../integrations/CONNECTOR-FRAMEWORK.md).*
