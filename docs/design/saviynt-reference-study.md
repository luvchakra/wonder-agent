# Saviynt reference study: a live-instance companion to the foundation design

| | |
|---|---|
| Status | Evidence for owner review. Proposes additions; changes nothing on its own. |
| Date | 2026-10-11 |
| Read with | [`WONDERID-FOUNDATION-DESIGN.md`](WONDERID-FOUNDATION-DESIGN.md) (the design baseline, pending decision D1) |
| Source | The owner's Saviynt Identity Cloud training tenant, **v25 "Chicago" GA**, signed in as its administrator |

## Why this document exists

The foundation design built its capability checklist (§12 there) from Saviynt's public pages, its public training guides and seven documents the owner supplied. It did not see the product itself.

This study is first-hand evidence from a running instance:
- what the product actually shows;
- how the screens and objects fit together;
- where that confirms the design, and where it adds something the design does not yet cover.

## Method and ground rules

- **Read-only browsing.** Every sidebar entry was opened by clicking through the menu: 118 pages plus the new Identities console.
  - For each page, the study recorded its headings, table columns, form fields, filters and action labels.
  - No form was submitted, no action button pressed, and "Application Restart" was not opened.
- **No tenant data.** The training tenant's records (people, accounts, sessions) are not reproduced.
- **No credentials.** The sign-in credentials are in no file in the repository. The owner should rotate them, since they were shared in a chat.
- **Capability level only**, the same rule the design follows (its preamble) and the owner's decision of 2026-10-10.
  - WonderID takes arrangement and capability, never Saviynt's wording, screens, configuration formats or assets.
  - Generic industry terms (accounts, entitlements, roles) are not borrowed names.

---

## 1. What the live product shows

### 1.1 One shell, two generations of pages

| Generation | Path | Pages |
|---|---|---|
| **Legacy** | `/ECM/…` | Server-rendered pages: about 90% of the admin and governance surface. |
| **New** | `/ECMv6/…` | React pages: the shell, home, privileged access, PAM sessions, duplicate identities, rule recommendations, branding, labels, log viewer and the Identities console. |

- **Legacy pages refuse direct navigation:** typing their address redirects to home. They open only from the menu.
- **One page broke:** Manage Apps (Integrations) rendered empty after 20 seconds.

**Lesson, consistent with design §8:** one UI generation, one design system, and every page addressable by its URL.

### 1.2 The menu (as observed)

The menu matches the design's §12.8 navigation row: a collapsible dark sidebar with page search, area → group → page, and an area's menu replacing the list with a back arrow. WonderID built this arrangement on 2026-10-10.

| Area | Groups → pages |
|---|---|
| **Home** | **My Access**: request for self; request enterprise roles; saved requests; manage my access; request history; pending requests; existing access.<br>**Access for Others**: single user; multi-user with file upload.<br>**Privileged Access**: assets & sessions; service accounts.<br>**User Management**: one-click disable of direct reports; create, upload and update user.<br>**Change Password**: own; others'; helpdesk reset; service account.<br>**Manage Entitlements / Endpoints / Roles / Organizations**: create, update or upload, each as a governed request.<br>**Service Accounts**.<br>**Delegates**: create; manage.<br>**Tasks**: pending; completed. |
| **Intelligence** | Dashboard · analytics controls · analytics history (two versions) · duplicate identities · **Role intelligence** (workbench, mining, entitlement discovery, role–access mismatch) · recommendation rulesets · license management · usage analytics · application audit logs · privilege ("firefighter") logs |
| **Integrations** | Manage Apps (rendered empty) |
| **Control Center** | PAM sessions · posture owner · privileged-access owner · compliance owner |
| **SOD** | Dashboard · violations · mitigating controls · **Ruleset** (rulesets, risks, functions, business processes) · simulation · ruleset change requests |
| **Certifications** | Dashboard · campaigns · templates · scheduled campaigns |
| **Identities** (New) | Identity classification: All / External |
| **Admin** | **Identity Repository**: dashboard, users, accounts, entitlements, roles, user groups, security systems, connections, password policies, organizations, datasets.<br>**Policies**: rule recommendations, technical (birthright) rules, user / organization / entitlement update rules, PAM policies, request rules, execution trail, scan rules.<br>Global configuration · admin roles · job control panel · archival library · application onboarding · onboarding questionnaire.<br>**Settings**: SMTP, e-mail templates, analytics, dashboards, configuration files, IdP, SSO, OAuth, web-service token, file directory, branding, labels, API, tab config, trust model.<br>**Workflows**: list; approval.<br>**Admin functions**: admin functions, log viewer, audit trail, certificates, data analyzer, e-mail history.<br>**Transport**: export; import. |

### 1.3 The object model, read from list columns and create forms

```text
Security system ─< Endpoint ─< Entitlement type ─< Entitlement value
      │  (import connection, provisioning connection)          │
      └─ Connection                     Account >──────────────┘
                                          │
                                        User ── manager, organizations, user groups, risk score
                                          │
                                        Role (enabler, transactional, emergency, enterprise, application, entitlement)
```

Details the design can use:

- **Five criticality ratings** on entitlements and roles, each on one 6-step scale (none to critical): SOX-critical, system-critical, risk, privileged, confidentiality.
- **Entitlement type behaviour:**
  - how it is offered in a request: single choice, multiple, table, free text, or *shown but not requestable*;
  - whether it is **certifiable**;
  - whether a **parent is required**;
  - an attached approval workflow.
- **Two owners on an application endpoint:** an *owner* and a *resource owner*, each a user or a group.
- **Separate connections for import and for provisioning** on the same system.
- **Organizations are typed by purpose:** data-security scope, grouping, request-rule scope, company. They nest.
- **Wide custom-property fields:** up to 45 on an endpoint. This is the anti-pattern the design avoids with typed attribute definitions.

---

## 2. Live capabilities mapped to the design

**Legend:**
- **Covered**: the design already plans it (section and phase given).
- **Built**: WonderID has it today.
- **Delta**: the live instance shows something the design does not yet cover; §3 proposes how to add it.
- **Out**: excluded on purpose (design §1.2, CLAUDE.md §10).

### 2.1 Home: requests, delegation, tasks, user management

| Observed | Design | Status |
|---|---|---|
| Cart request for self, for another person, for many (with a file upload) | §5.3 basket, request for others, bulk | Covered, F2 (for others) / F7 (bulk) |
| Pending and history lists with type, ID, applications, requested for/by, **assigned to**, submitted, **expires**, status | §5.3 SLA and escalation; approval engine with expiry | Built + F2 |
| **Saved request drafts** (created by, requested for, application) | none | **Delta D-1** |
| Existing access per person, split into enterprise roles / applications / the platform's own access | Access ledger (0114), §8 My Access | Built / in progress |
| Delegates: parent, delegate, start and end; Active / Upcoming / Expired | ACCESS-P0-23 | Covered, F5 |
| Provisioning tasks: type, parent task, account, endpoint, entitlement, request, owner, status, **provisioning comments and metadata**; pending vs completed | §5.3 manual fulfilment, §5.8 pipeline, §8 tasks inbox | Covered, F2 (tasks) / F3 (pipeline) |
| One-click disable of a direct report | §5.2 manager kill action | Covered, F4 (plan) / F3 (execution) |
| Create, update or upload users, with options: generate username, generate e-mail, check rules, expire first password, reconciliation key | §5.1 item 6 (WonderID as source of record), §5.10 forms | Covered, F7/F8; **Delta D-2** for generated identifiers |
| Catalogue objects changed through governed requests (new entitlement, endpoint, role, organization) | §5.4 role lifecycle publish; versioned config | Partly covered; **Delta D-3** |
| Password change for self, others, helpdesk, service accounts | §5.9: trigger the target's own reset, never handle the value (D5) | Covered (as a design choice) |

### 2.2 Privileged access

| Observed | Design | Status |
|---|---|---|
| "Available assets" card list: emergency roles and targets (database, Windows, Unix, cloud console) with platform, asset-type and role-type filters | §5.7 emergency sessions, JIT | Covered, F8 |
| Service accounts with an owner; "reserve next slot" | §5.7 ownership of shared and service accounts | Covered, F8 (slot reservation is PAM: Out) |
| Session list: user, endpoint, application type, account, start, end, **credential vs credential-less**, source IP, request id | §5.7 post-use review from the target's logs | Covered, F8; **Delta D-4** for the evidence record fields |
| PAM policies (endpoint-group and emergency-role) | §5.7 eligibility and approval | Covered, F8 |
| Vault and session broker | §1.2 not a PAM vault | Out |

### 2.3 Intelligence

| Observed | Design | Status |
|---|---|---|
| Analytics controls: category, sub-category, risk, tags, owner, schedule, recommendations; run or schedule | §5.11 reports, findings; §12.8 "no raw SQL exposed to tenants" | Covered, F9 |
| **Analytics history:** per control, conflict count, **open** count, last run, trend; filters by category, risk, tags and application | none (reports are point-in-time) | **Delta D-5** |
| Duplicate identity management: primary record, candidates, common vs uncommon attributes, merge with summary | §12.1 marks "duplicate identity detection over existing identities" as **Built**. **Correction:** today only *agents* have it (`modules/agent-identity/duplicates.ts`); human identities have the import-time correlation queue (Pending Matches) but no merge of existing records. | **Delta D-6** |
| Role intelligence: workbench, mining by users or roles, entitlement discovery, role–access mismatch | §5.4 role and rule mining; §5.8 drift classification | Covered, F1 (drift) / F8 (mining) |
| License management, usage analytics | §12.5 unused-access report | Covered, F9 |
| Application audit logs (raw host, port and client fields) | §1.2 not a SIEM | Out |
| Privilege ("firefighter") log: who used emergency access, which roles, when | §5.7 post-use review | Covered, F8 |

### 2.4 Control Center

| Observed | Design | Status |
|---|---|---|
| One page per **owner persona** (privileged-access, posture, compliance), each a queue of that owner's findings sorted by relevance or severity | §5.11 posture page; §5.7 privileged inventory "shown on Control Center" | Partly covered; **Delta D-7** |

### 2.5 Separation of duties

| Observed | Design | Status |
|---|---|---|
| Ruleset → risk (functions 1–3, priority, type, business process) → function → entitlements | §5.6 risk → business functions → expressions; rulesets | Covered, F5 |
| Per ruleset: "evaluate in access requests" | §5.6 preventive mode | Covered, F5 |
| Violations: risk, functions, priority, person, account, application, **actual vs potential**, audit trail | §5.6 detective; exercised flag | Covered, F5 / F8 |
| Violation states: Open → **In Process** → Risk Accepted → Closed / Remediated, with group-by on person, entitlement, risk, process, application | §5.6: open, mitigated, remediated, accepted | Covered; **Delta D-8** (an "in review" state and group-by views) |
| Mitigating controls with business process, ruleset, priority, **expiry** | §5.6 library; expiry reopens | Covered, F8 |
| Simulation runs (name, system, ruleset, expiry, status) | §5.6 simulation | Covered, F5 |
| **Ruleset change requests:** function changes are versioned and approved or rejected | §5.6 rulesets with version history | Covered; approval of changes made explicit in **Delta D-3** |
| Guardrail: SoD evaluation never runs at the same time as an import of the same application | none | **Delta D-9** |

### 2.6 Certifications

| Observed | Design | Status |
|---|---|---|
| Campaign states: in progress, expired, discontinued, complete, **preview**, launching, error; progress; owner; "consulted" | §5.5 types, consult, status tracking | Covered, F4; **Delta D-10** (preview before launch) |
| **Campaign templates** (name, type, created and updated by) | §5.5 scheduling (no templates named) | **Delta D-10** |
| Scheduled campaigns: cron, next fire, **time zone**, launch type | §5.5 scheduling | Covered, F4 |
| E-mail templates per campaign event, including five reminders | §8 e-mail templates | Covered, F7 |

### 2.7 Policies and rules

| Observed | Design | Status |
|---|---|---|
| Technical (birthright) rules, user update rules | §5.2 lifecycle rules | Covered, F4 |
| **Organization update rules, entitlement update rules** (act when an organization or entitlement changes, e.g. an entitlement becomes privileged) | §5.2 covers identity events only | **Delta D-11** |
| Request rules (add items or approvals to requests) | §5.3 risk-based routing, request policies | Built + F2 |
| A **detective** flag per rule (report only) vs acting | §5.2 simulation before publish | Partly covered; **Delta D-11** |
| **Execution trail:** every rule run, with person, rule, action, status (failed, error, success), plus failed user imports | §5.10 workflow runs record steps | **Delta D-12** |
| Scan rules (file and data scans) | none | Out (data scanning is not identity governance) |

### 2.8 Administration

| Observed | Design | Status |
|---|---|---|
| Global configuration with hundreds of keys (General, Ruleset) | Built (0116), "add a setting only with the code that reads it" (§8) | Built; stay small |
| Admin roles; API access limited by admin role and organization | Built roles, scoped assignments | Built |
| Job control panel: category (analytics, certification, control center, data, system, utility), last and next run, status; add a job; **pause all** | §5.10 jobs page | Covered, F7 ("pause all" stays platform-only) |
| Archival library (login and job history by period, size, download) | §5.11 archival | Covered, F9 |
| Application onboarding list (owner, resource owner, parent, creator, status) and questionnaire (question, section, order, target field, answer type, required) | Built onboarding (0088) + §5.10 forms | Built + F7 |
| Workflows: versioned, **activated by and on**, and **approval of workflow changes** | §5.10 workflow engine | Covered, F7; change approval in **Delta D-3** |
| **Audit trail with attribute, old value and new value** per change; filter by object type and action | §5.11 audit content (actor, subject, target, action, outcome…) has no attribute diff | **Delta D-13** |
| Certificate management: alias, connection, issuer, subject, **expiry**, status; import | §5.8.1 relay key-expiry alerts | Partly covered; **Delta D-14** |
| E-mail history: subject, recipients, template, activity, request id, status, **failure logs** | §8 e-mail delivery history | Covered, F7 |
| Transport: export and import packages of configuration objects with a business justification and history | §8 configuration promotion (diff-first, signed bundle) | Covered, F7 |
| Branding (themes, logos), **labels per language** | §8 labels and branding | Built (branding) + F9 |
| Trust model: a formula over signals giving a trust score | §12.4: recommendations only, no automatic certify (D6) | Out (deliberate) |
| SMTP with test connection; IdP, SSO, OAuth token expiry; web-service tokens | Supabase Auth, SSO built; agent tokens §6.2 | Built + F6 |

### 2.9 Identities console (new)

| Observed | Design | Status |
|---|---|---|
| External identities classified into three families with sub-types: **third parties** (vendors, suppliers, service providers, contractors, call centres), **partners** (brokers, franchise workers, clinicians, retailers, distributors), **individuals** (temps, retirees, volunteers, students, seasonal workers) | §5.1 item 8 classification queue; `external_organizations` | Covered, F1 (unowned queue) / F8; **Delta D-15** (sub-type taxonomy) |
| Home banner inviting the administrator to classify identities | §8 home banner | Covered, F9 |

---

## 3. Proposed additions to the foundation design

Each delta names the design section it would extend, the owning module, and a suggested phase (phases as revised in the design's §10 on 2026-10-11). None changes a non-negotiable. Each would need the same treatment as the design's proposals: owner approval (D1), an additive migration where data is involved, RLS and an isolation test.

| # | Addition | Extends | Module | Phase |
|---|---|---|---|---|
| **D-1** | **Saved request drafts.** A requester can save a basket and come back to it. A draft grants nothing and expires after a set time. | §5.3 | Access | F7 |
| **D-2** | **Generated identifiers for WonderID-authoritative populations.** When WonderID is the source of record (contractors, volunteers), a tenant rule generates the username and e-mail, with a uniqueness check and a reserved-words list. | §5.1 item 6 | Identity | F7 |
| **D-3** | **Approval of changes to governance objects.** Publishing a new version of a role, SoD function or risk, lifecycle rule, request policy or workflow is a maker–checker change: the database four-eyes trigger plus a diff of the version. This extends §5.4's "every publish is a new version" to all of them, as SOX ITGC change management (§7.3). | §5.4, §5.6, §5.10, §7.3 | Access, Identity, Operations | F5 (roles, SoD), F7 (workflows) |
| **D-4** | **Privileged-session evidence record.** The fields a connector imports for post-use review: person, target, application type, account, start, end, session mode (credential released or credential-less), source address, and the WonderID request it belongs to. | §5.7 post-use review | Integration (import), Access (review) | F8 |
| **D-5** | **Control history.** For every deterministic risk rule or report control, keep each run's counts (found, still open, closed since last run), so owners see a trend. | §5.11 | Risk + Operations | F9 |
| **D-6** | **Human identity merge.** Detect likely duplicate people over existing records, not only at import. Compare attributes side by side; the person deciding chooses the surviving value per attribute. Merge accounts and access onto the survivor and keep a reversible merge record. Nothing merges without a person (§17.6). This also corrects the "Built" claim in design §12.1. | §5.1, §12.1 | Identity | F4 |
| **D-7** | **Owner queues on Control Center.** One page with a "mine" filter: the findings, violations and expiring items owned by the viewer (privileged accounts, posture, compliance), sorted by severity. This keeps one page rather than one per persona (§19.5). | §5.11 posture, §8 | Experience + Risk | F9 |
| **D-8** | **SoD violation workflow.** Add an "in review" state between open and resolved, and saved group-by views (by person, entitlement, risk, business process, application). | §5.6 | Access | F5 |
| **D-9** | **No overlap between evaluation and import.** Detective SoD for an application waits while an import of that application is running, so a violation list never reflects a half-imported state. The same applies to drift classification. | §5.6, §5.8 | Access + Integration | F1 (drift) / F5 (SoD) |
| **D-10** | **Campaign templates and preview.** A campaign is created from a versioned template (type, scope, reviewers, schedule, reminders). It is generated in a *preview* state, where the owner checks population counts against the latest import (§5.5 evidence item 1) before launch. | §5.5 | Compliance | F4 |
| **D-11** | **Rules on entitlement and organization changes, and detective-only rules.** Lifecycle rules can trigger on an entitlement or organization changing, as well as on identity events (an entitlement newly marked privileged → review its holders). Any rule can run in a report-only mode that records what it would do. | §5.2 | Identity + Access | F4 |
| **D-12** | **Automation run log.** One list of every automatic decision: lifecycle rule, birthright grant, detective scan, import apply. It shows the input, the outcome (success, failed, error) and the error, with failed source rows. This is §17.7 provenance made visible, and the same place as the jobs page history. | §5.10, §5.11 | Operations | F7 |
| **D-13** | **Attribute-level change detail in audit.** For changes to configuration and catalogue objects, the audit event carries the changed attributes with old and new values. Never secrets, and erased personal data stays out (§18.3). The hash chain is unchanged. | §5.11 audit content | Foundation + Operations | F4 |
| **D-14** | **Connector certificate inventory.** Certificates used by connections (and relays) with issuer, subject and expiry, alerting before expiry, alongside relay key expiry. | §5.8.1 | Integration | F3 |
| **D-15** | **External identity sub-types.** A tenant-editable taxonomy (third party, partner, individual, each with sub-types) on external identities. The type sets defaults for sponsor requirement, maximum contract length and review frequency. | §5.1 item 8, §12.1 | Identity | F8 |

Two smaller observations do not need their own row:

- **Criticality ratings** (2.1 above): the design's privilege level, data classification and SOX-relevant flag already cover the useful ones. Keeping them separate, not a single "risk", is the point.
- **The two owners on an application** (2.1): the design's ranked owners can express it. The approval routing should name which owner approves access to the application and which approves access to its data.

---

## 4. Patterns: adopt or avoid

**Adopt.** All already align with the design's principles:
- **The same list frame everywhere:** search, filters, a column chooser, one Actions menu, export. WonderID's object pages have it; keep one primary action (P10).
- **Expiry on everything temporary:** requests, delegations, mitigations, risk acceptances, campaigns, certificates.
- **Versioned governance objects** with approved changes (D-3).
- **Separate import and provisioning paths** per system, as the design's capability flags already allow.

**Avoid.** The design already rules each of these out:
- **Two UI generations,** and pages that only open from the menu.
- **Very wide forms:** 45 custom properties; an 18-field role form on one page.
- **Hundreds of configuration keys** with no link to the code that reads them.
- **Infrastructure logs, vaulting, setting passwords** (SIEM, PAM and IdP territory).
- **A configurable trust formula that auto-certifies** (decision D6).

---

## 5. Limits of this reading

- **Manage Apps** rendered empty, so the newer integration catalogue was not seen.
- **Role–access mismatch** answered "access denied" for this administrator.
- The four dashboards had no widgets configured. Rule recommendations reported "not set up".
- Only list pages and create forms were read. Multi-step flows (submitting a request, reviewing, merging, simulating) were not run, so their later steps are inferred from labels.
- Product documentation behind the customer sign-in was not used, as in the design (§12).
