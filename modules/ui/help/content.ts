/**
 * The WonderID user guide, as structured data rather than prose pages.
 *
 * Structured because two surfaces read it: `/help` renders it, and the help
 * assistant (`lib/ai/helpAnswer.ts`) retrieves against it. Keeping one
 * source means an answer can never cite a section that does not exist —
 * the assistant picks from these entries and links their anchors, rather
 * than inventing a link.
 *
 * Content rule: describe only what is actually built. Where a capability is
 * planned but not shipped, say so in `body` explicitly — a guide that
 * promises a missing screen is worse than no guide.
 */

export type GuideCategory =
  | "Getting started"
  | "Core model"
  | "Identities"
  | "Agents"
  | "Applications"
  | "Access"
  | "Runtime"
  | "Risk"
  | "Compliance"
  | "Integrations"
  | "Operations"
  | "Administration"
  | "Settings"
  | "FAQ";

export type GuideSection = {
  /** Anchor id — the assistant links to `/help#<id>`. */
  id: string;
  title: string;
  category: GuideCategory;
  /** One sentence, used verbatim when the assistant has no AI provider. */
  summary: string;
  body: string[];
  /** Extra retrieval terms that a user might type but the prose doesn't contain. */
  keywords: string[];
  /** The in-app screen this section describes, when there is one. */
  href?: string;
};

export const GUIDE_SECTIONS: GuideSection[] = [
  // ------------------------------------------------------------ Getting started
  {
    id: "what-is-wonderid",
    title: "What WonderID is",
    category: "Getting started",
    summary:
      "WonderID is an identity governance and security platform for people, external users, machine identities and AI agents: who holds access, why, who approved it, and whether it is still appropriate.",
    body: [
      "WonderID treats anything that can receive, use, delegate or lose access as an identity: employees, contractors, external users, service accounts, workloads, APIs and AI agents. For each one it answers who it is, what access it has, why it has it, who approved it, and whether it is still appropriate.",
      "It started as WonderAgent, an AI agent governance product, and that remains its deepest area: every agent gets an owner, an approved purpose, a known set of permissions and an observable record of what it actually did. People, applications, access requests and administration are now governed with the same deterministic controls.",
      "WonderID is not an identity provider, a PAM vault, a secrets vault or a SIEM. Your IdP still signs people in to your systems, and your HR and directory systems remain the source of truth for what they own. WonderID reads from them, keeps a vendor-neutral picture, and shows where approved access, actual capability and real behaviour disagree.",
    ],
    keywords: ["overview", "introduction", "what is", "purpose", "product", "about", "wonderagent"],
  },
  {
    id: "first-steps",
    title: "Your first 15 minutes",
    category: "Getting started",
    summary:
      "Create an organization, invite your team, bring in identities and access from your source systems, give agents an owner and a contract, then review the findings.",
    body: [
      "1. Create your organization when you first sign up. Everything in WonderID is scoped to it — data is never shared between organizations.",
      "2. Invite your colleagues under Permissions → Users and give them roles (or put them in groups that carry roles).",
      "3. Add your sources under Integrations: identity sources for people (HR, directory), connectors for IAM data, and MCP runtime events.",
      "4. Review what arrived: Identities for people and machine identities, Applications for the catalog and accounts, and AI Agents → Discovery Inbox for agents found in your systems.",
      "5. Give each agent an owner and a contract — its approved applications, data and actions. That is what Approved (SHOULD) means for it.",
      "6. Open Risk & Security. Findings appear wherever access or behaviour goes beyond what was approved.",
    ],
    keywords: ["setup", "start", "onboarding", "quick start", "begin", "first", "walkthrough", "getting started"],
    href: "/",
  },
  {
    id: "navigating",
    title: "Finding your way around",
    category: "Getting started",
    summary:
      "The sidebar groups WonderID by area — Identities, Applications, Access Governance, AI Agents, Risk & Security and administration — and shows only what your role can use.",
    body: [
      "The left sidebar collapses to icons; hovering a group while collapsed opens its pages. On a phone it becomes a menu drawer with a tab bar at the bottom.",
      "Search (the box in the header, or its keyboard shortcut) looks across your organization's agents, identities, findings and policies — never another organization's.",
      "Light, dark or system theme is chosen from the account menu, which is also where Get Help lives.",
      "If a page or button you expect is missing, your role probably doesn't include it — see “Why can't I see a page or button?”.",
    ],
    keywords: ["navigation", "sidebar", "menu", "where is", "find", "theme", "dark mode", "light mode", "mobile", "search box"],
  },
  // ----------------------------------------------------------------- Core model
  {
    id: "should-can-did",
    title: "Approved (SHOULD) vs Effective Access (CAN) vs Observed (DID)",
    category: "Core model",
    summary:
      "Approved (SHOULD) is what an identity is approved to do, Effective Access (CAN) is what its access technically permits, and Observed (DID) is what it actually did — findings come from the gaps between them.",
    body: [
      "Approved (SHOULD) comes from an agent's contract: the purpose, applications, data classes and actions you approved.",
      "Effective Access (CAN) is computed from IAM data — the entitlements, roles, groups, OAuth scopes and tool permissions the identity actually holds. An agent frequently CAN do far more than it SHOULD.",
      "Observed (DID) comes from observed runtime activity: the tools, resources and actions it really used.",
      "The value is in the comparison. Access it CAN use but SHOULD not have is excessive access. Something it DID that it SHOULD not have done is a violation. Runtime and Risk show these side by side.",
    ],
    keywords: ["should", "can", "did", "model", "comparison", "concept", "gap", "excessive", "difference"],
    href: "/runtime",
  },
  // ----------------------------------------------------------------- Identities
  {
    id: "identities",
    title: "The identity directory",
    category: "Identities",
    summary:
      "Identities lists every governed identity — people, external identities, machine identities and AI agents — with its type, status, owner and source.",
    body: [
      "Identities → Overview counts identities by type. All Identities, People, External Identities and Machine Identities each list one slice, filtered and paginated in the database.",
      "Open an identity to see its profile, the access it holds, who owns it and its history. Each attribute shows where it came from, so a value owned by your HR system is never silently overwritten here.",
      "Identities → Non-human Identities lists service accounts and keys with their owner and expiry. Administration → Identity Attributes defines the attributes your organization tracks.",
    ],
    keywords: ["identity", "identities", "people", "person", "employee", "contractor", "external", "machine", "service account", "directory", "nhi", "non-human"],
    href: "/identities",
  },
  {
    id: "identity-lifecycle",
    title: "Joiners, movers and leavers",
    category: "Identities",
    summary:
      "Lifecycle Work turns joiner, mover and leaver events into governed tasks, including transferring what a leaver owned.",
    body: [
      "Identities → Lifecycle Work lists the work a change creates: access to grant for a joiner, access to review for a mover, access to remove for a leaver.",
      "Consequential steps wait for a person to approve them; nothing is revoked silently.",
      "When someone who owns agents or other identities leaves, ownership is transferred to a named successor and the change is audited.",
    ],
    keywords: ["joiner", "mover", "leaver", "lifecycle", "onboard", "offboard", "termination", "rehire", "transfer ownership", "tasks"],
    href: "/identities/lifecycle",
  },
  {
    id: "identity-sources",
    title: "Authoritative identity sources",
    category: "Identities",
    summary:
      "Identity sources import people from HR and directory systems, with precedence rules when two sources disagree and a review queue for uncertain matches.",
    body: [
      "Integrations → Identity Sources adds a source and runs imports. Each run reports what it created, updated and could not decide.",
      "When two sources supply the same attribute, the one you rank higher wins, and the losing value is kept as provenance rather than discarded.",
      "Records that might match an existing identity but aren't certain go to Integrations → Pending Matches for a person to confirm or reject — WonderID never guesses silently.",
    ],
    keywords: ["hr", "directory", "source of truth", "authoritative", "import people", "precedence", "pending matches", "reconciliation", "correlation"],
    href: "/integrations/sources",
  },
  // --------------------------------------------------------------------- Agents
  {
    id: "register-agents",
    title: "Registering and owning agents",
    category: "Agents",
    summary:
      "Register an agent to bring it under governance, then assign an accountable owner — unowned agents are themselves a finding.",
    body: [
      "AI Agents → Register Agent adds one manually. Most agents instead arrive through an integration and are registered from the Discovery Inbox.",
      "Every agent needs an owner: a named person accountable for it. Delegated owners can share the work, and an ownership review confirms owners are still right. Missing ownership is flagged as a governance risk.",
      "Agents move through lifecycle states (proposed, active, restricted, suspended, retired). Every transition is recorded with who made it and why.",
    ],
    keywords: ["register", "create agent", "owner", "ownership", "lifecycle", "retire", "suspend", "new agent", "delegated owner"],
    href: "/agents/new",
  },
  {
    id: "agent-contract",
    title: "Agent contracts (defining Approved (SHOULD))",
    category: "Agents",
    summary:
      "An agent contract records the approved purpose, applications, data and actions for one agent — it is the baseline every risk check compares against.",
    body: [
      "Open an agent and edit its contract: business purpose, which applications it may touch, which data classes, and which actions (for example READ and REPORT but not WRITE or DELETE).",
      "Contracts also carry autonomy and oversight — autonomy level, allowed tools, whether human approval is required, and what monitoring is expected. A completeness score shows what is still missing.",
      "Without a contract an agent has no SHOULD, so excessive-access and unauthorized-action findings cannot be calculated for it.",
    ],
    keywords: ["contract", "purpose", "approved", "should", "baseline", "autonomy", "completeness"],
    href: "/agents",
  },
  {
    id: "discovery",
    title: "Agent discovery and Shadow AI",
    category: "Agents",
    summary:
      "The Discovery Inbox lists agent-like identities found in your systems so you can register, link or ignore each one; activity from unregistered agents is marked Shadow AI.",
    body: [
      "After a sync, WonderID looks for identities that behave like AI agents and lists them in AI Agents → Discovery Inbox with the evidence and a confidence signal.",
      "Register a candidate as a governed agent, link it to one you already have, or ignore it. Ignoring is recorded, so the same candidate doesn't reappear as noise.",
      "AI Agents → Duplicate Review proposes merges when the same real agent appears under several identities. Runtime activity from an agent nobody registered is shown as Shadow AI, with where it was seen.",
    ],
    keywords: ["discovery", "inbox", "candidates", "unregistered", "shadow", "shadow ai", "duplicates", "merge"],
    href: "/agents/discovery",
  },
  {
    id: "agent-api-keys",
    title: "Agent API keys",
    category: "Agents",
    summary:
      "An agent authenticates to the Runtime Gateway with its own API key; the secret is shown once, can expire, and can be revoked at any time.",
    body: [
      "Open an agent and create a key in its API keys panel. Copy the secret straight away — WonderID stores only a hash and can never show it again.",
      "Keys can carry an expiry date. Revoking one takes effect immediately; incident responders can revoke all of an agent's keys at once from the runtime emergency controls.",
    ],
    keywords: ["api key", "agent key", "token", "secret", "rotate", "revoke key", "credential"],
    href: "/agents",
  },
  // --------------------------------------------------------------- Applications
  {
    id: "applications",
    title: "Applications and onboarding",
    category: "Applications",
    summary:
      "Applications → Application Inventory is the catalog of every application you govern; new ones are onboarded step by step before they go live.",
    body: [
      "Each application has an owner, a type and an onboarding status. Add one from the inventory, then walk it through onboarding: configure, validate the connection, simulate what it would import, approve, and promote.",
      "A failed validation stops onboarding visibly with the reason; nothing is promoted half-finished.",
      "Applications → Discovery lists applications seen in your systems that nobody has registered yet. Onboarding suggestions may be drafted with AI, but they are proposals a person accepts or rejects — never applied on their own.",
    ],
    keywords: ["application", "app", "catalog", "inventory", "onboarding", "onboard application", "validate", "simulate", "promote", "unrecognized"],
    href: "/access",
  },
  {
    id: "accounts",
    title: "Accounts and data sources",
    category: "Applications",
    summary:
      "The account inventory correlates every application account to an identity and flags orphaned and dormant accounts; data sources record where sensitive data lives.",
    body: [
      "Applications → Accounts lists accounts from connected applications. Each is correlated to the identity that owns it; an account with no owner is orphaned, one unused for a long time is dormant.",
      "Applications → Data Sources records databases and stores with their sensitivity, and links them to applications. This is part of what an agent CAN reach.",
    ],
    keywords: ["account", "orphan", "orphaned", "dormant", "unused", "data source", "database", "sensitivity", "correlate"],
    href: "/access/accounts",
  },
  // --------------------------------------------------------------------- Access
  {
    id: "effective-access",
    title: "Effective Access (CAN)",
    category: "Access",
    summary:
      "The effective access view computes what an identity can technically do today, including access inherited through roles and groups, and shows the path that grants it.",
    body: [
      "It resolves entitlements, application roles, groups, OAuth scopes and tool permissions across every identity an agent owns.",
      "Access paths matter as much as totals: WonderID shows how a permission was granted — directly, through a role, through nested groups or through delegation — so you remove the right grant.",
      "This is the CAN half of the model, computed from imported IAM data rather than asserted by hand.",
    ],
    keywords: ["effective", "entitlement", "can", "path", "graph", "inherited", "nested group"],
    href: "/access",
  },
  {
    id: "access-requests",
    title: "Requesting and approving access",
    category: "Access",
    summary:
      "People request access from a catalog; each request follows its request policy through staged approvals, with four-eyes and separation-of-duties checks enforced.",
    body: [
      "Access Governance → Request Access shows what you are eligible to request. Pick an application or entitlement, give a reason and submit.",
      "Access Governance → Request Policies decide who approves (manager, entitlement owner, application owner, access managers), in what order, and when a request expires or escalates.",
      "Approvers decide in Access Requests. Nobody can approve their own request — the database refuses it — and a change to what was requested invalidates earlier approvals.",
      "If the request would combine entitlements that conflict under separation of duties, the conflict is shown before anyone approves.",
    ],
    keywords: ["request", "request access", "approve", "approval", "approver", "reject", "four eyes", "sod", "separation of duties", "request policy", "escalation"],
    href: "/access/catalog",
  },
  {
    id: "access-packages",
    title: "Access packages",
    category: "Access",
    summary:
      "An access package bundles the entitlements a job needs so they can be requested, approved and assigned together, and removed together when they expire.",
    body: [
      "Access Governance → Access Packages lists packages, their contents and who is eligible to see them.",
      "A package request goes through the same approval engine as any other request. Once approved, each item is provisioned as its own work item — one that fails is shown as failed rather than hidden.",
      "Assignments can expire; expiry creates the revocation work for every item in the package.",
    ],
    keywords: ["package", "access package", "bundle", "birthright", "assignment", "expiry", "provisioning"],
    href: "/access/packages",
  },
  {
    id: "policies",
    title: "Governance policies",
    category: "Access",
    summary:
      "Governance policies express organization-wide rules that identities and agents are evaluated against, independently of any single agent's contract.",
    body: [
      "Where a contract is per agent, a policy applies across them — for example forbidding write access to a production financial system, or requiring human approval for a class of action.",
      "Policies are versioned: a draft has no effect until it is published, and exceptions are recorded with who granted them.",
      "Policy evaluation is deterministic. Violations surface as findings in Risk & Security. (Rules about who may use WonderID itself are Authorization policies, under Administration.)",
    ],
    keywords: ["policy", "policies", "rule", "violation", "guardrail", "evaluation", "publish", "exception"],
    href: "/policies",
  },
  // -------------------------------------------------------------------- Runtime
  {
    id: "runtime",
    title: "Runtime activity — Observed (DID)",
    category: "Runtime",
    summary:
      "Runtime shows what each agent actually did — the tools, resources and actions observed — and compares it against SHOULD and CAN.",
    body: [
      "Runtime events arrive from MCP observation, the Runtime Gateway and other configured sources, and build a timeline per agent of tools invoked, resources touched and actions taken.",
      "The comparison view puts Approved (SHOULD), Effective Access (CAN) and Observed (DID) side by side for one agent — usually the fastest way to explain a finding.",
      "Events are de-duplicated, and anything that can't be processed is quarantined for review rather than dropped.",
    ],
    keywords: ["runtime", "activity", "events", "did", "timeline", "mcp", "observed", "behaviour", "behavior"],
    href: "/runtime",
  },
  {
    id: "runtime-gateway",
    title: "The Runtime Gateway",
    category: "Runtime",
    summary:
      "Agents can ask the Runtime Gateway before acting; it answers ALLOW or DENY from the agent's contract and policies, in observe-only mode unless enforcement is turned on.",
    body: [
      "An agent calls the gateway with its API key and the action it intends. The decision is recorded and appears in the agent's runtime timeline.",
      "In observe mode the gateway records what it would have decided without blocking anything. With enforcement on for your organization, a DENY is returned to the agent and your organization is notified.",
      "Repeating a request id returns the same decision rather than a second one.",
    ],
    keywords: ["gateway", "runtime gateway", "enforce", "enforcement", "observe mode", "allow", "deny", "decision"],
    href: "/runtime",
  },
  {
    id: "emergency-controls",
    title: "Emergency controls",
    category: "Runtime",
    summary:
      "Incident responders can engage a kill switch, suspend tools or revoke all of an agent's keys at once — each with a reason, each audited, each reversible.",
    body: [
      "Runtime → emergency controls act immediately. Engaging one requires a reason; lifting it does too.",
      "These actions need the runtime emergency permission, which is deliberately separate from everyday agent administration.",
    ],
    keywords: ["emergency", "kill switch", "incident", "stop agent", "block", "suspend tools", "panic"],
    href: "/runtime",
  },
  // ----------------------------------------------------------------------- Risk
  {
    id: "findings",
    title: "Risk findings",
    category: "Risk",
    summary:
      "Findings are deterministic, evidence-backed risk records — excessive access, unauthorized actions, sensitive-data violations, ownership gaps and behavioural deviation.",
    body: [
      "Risk & Security → Risk Overview lists open findings with a severity, the identity involved and the evidence that produced them. Every finding traces back to the specific access or event behind it.",
      "Risk scoring is deterministic and rule-driven. A language model never decides a severity or produces a finding.",
      "Findings carry a recommended remediation, but consequential changes (revoking access, suspending an agent) need a person to initiate them. Once the underlying access changes, the finding is re-evaluated and resolved if it no longer holds.",
    ],
    keywords: ["risk", "finding", "alert", "severity", "critical", "violation", "excessive access", "score", "remediation"],
    href: "/risk",
  },
  {
    id: "investigations",
    title: "Investigations",
    category: "Risk",
    summary:
      "An investigation groups related findings into one case with a timeline, notes and an outcome, so a team can work it to a conclusion.",
    body: [
      "Open one from a finding or from Risk & Security → Investigations. Add notes and evidence as you go; the timeline records who did what.",
      "Closing an investigation records its outcome; the findings themselves still resolve only when the underlying access or behaviour changes.",
    ],
    keywords: ["investigation", "case", "incident", "triage", "notes", "timeline"],
    href: "/risk/investigations",
  },
  {
    id: "rogue-agents",
    title: "Rogue agent detection",
    category: "Risk",
    summary:
      "Rogue detection highlights agents whose combined signals — unapproved access, unexpected behaviour, missing ownership — show they are operating outside governance.",
    body: [
      "A single finding rarely means an agent is rogue. AI Agents → Rogue Agents aggregates the signals for one agent so a pattern is visible.",
      "Use it to prioritize: it answers 'which agent should I look at first'.",
    ],
    keywords: ["rogue", "detection", "anomaly", "deviation", "suspicious", "priority"],
    href: "/risk/rogue",
  },
  // ----------------------------------------------------------------- Compliance
  {
    id: "certification",
    title: "Certification campaigns",
    category: "Compliance",
    summary:
      "Campaigns ask reviewers to certify access on a schedule, recording keep or revoke decisions with evidence for audit.",
    body: [
      "Certifications → Certification Campaigns launches a round. Each item pairs access with the risk and usage evidence a reviewer needs.",
      "Reviewers certify, flag or revoke. Every decision is recorded with who made it, when, and on what evidence; revocations become remediation work.",
      "Overdue items escalate, and a finished campaign produces an evidence pack for your auditor. Campaigns cover AI agents' access today; reviews of people's access and of WonderID role assignments are being added.",
    ],
    keywords: ["certification", "campaign", "attestation", "review", "recertification", "audit", "evidence", "compliance", "control"],
    href: "/compliance/campaigns",
  },
  // --------------------------------------------------------------- Integrations
  {
    id: "integrations",
    title: "Connecting source systems",
    category: "Integrations",
    summary:
      "Integrations import identities, permissions and runtime events from your existing systems; credentials are encrypted and connectors are read-only unless explicitly granted write access.",
    body: [
      "Integrations → Connectors adds a source. WonderID ships a Saviynt read integration, a generic REST connector and MCP runtime ingestion, plus webhook endpoints for push-style sources. People come in through Identity Sources.",
      "Credentials are encrypted at rest and are never returned by any API, logged, or shown back after saving. Outbound calls are checked so a connector can't be pointed at internal network addresses.",
      "A connector declares its capabilities explicitly. One configured read-only cannot write or remediate — that boundary is enforced, not merely documented.",
      "Sync runs appear under Integrations → Sync Jobs with their status and errors. Integrations → MCP Servers inventories the servers, tools and resources your agents use.",
    ],
    keywords: ["integration", "connector", "saviynt", "rest", "mcp", "webhook", "sync", "import", "credentials", "connect"],
    href: "/integrations",
  },
  // ----------------------------------------------------------------- Operations
  {
    id: "reports-audit",
    title: "Reports, audit and search",
    category: "Operations",
    summary:
      "The audit trail records every security-sensitive action, reports export governance evidence, and search spans your organization's records.",
    body: [
      "Insights → Audit Trail records actor, target, action, time and outcome for every security-sensitive operation — including refusals, such as an action an authorization policy denied.",
      "Insights → Reports produce exportable evidence, including a governance evidence pack as PDF and CSV exports of the underlying data.",
      "Search covers agents, identities, findings and policies from one box, scoped to your organization.",
    ],
    keywords: ["audit", "log", "report", "export", "csv", "pdf", "evidence", "search", "history", "who did"],
    href: "/audit",
  },
  {
    id: "notifications",
    title: "Notifications",
    category: "Operations",
    summary:
      "Notifications alert the right people to critical findings, approvals waiting on them, overdue certifications and failed syncs, in-app and by email when email is configured.",
    body: [
      "Administration → Notifications controls which events reach you. Some security notifications are mandatory and can't be switched off.",
      "In-app notifications always work; email delivery additionally needs the deployment's email provider. Without it you still get the in-app copy.",
    ],
    keywords: ["notification", "email", "alert", "digest", "subscribe", "announcement"],
    href: "/settings/notifications",
  },
  // ------------------------------------------------------------- Administration
  {
    id: "users",
    title: "Users and membership",
    category: "Administration",
    summary:
      "Permissions → Users lists the people in your organization; add them by invitation, and suspend, reactivate, deactivate or remove them with a recorded reason.",
    body: [
      "Add user invites someone by email with the roles they should start with; they join when they accept. If email isn't configured, you're told so and they can use “Forgot password” on the sign-in page.",
      "Suspending someone ends their sessions at once; reactivating restores access. Removing them also clears their roles and group memberships, while their history stays in the audit trail.",
      "A user's page shows their roles and groups, their effective permissions with where each comes from, their access history and their live sessions.",
      "Nobody can change their own membership or give themselves a role, and the organization always keeps at least one Tenant Administrator.",
    ],
    keywords: ["user", "users", "invite", "invitation", "add user", "suspend", "deactivate", "remove user", "member", "membership", "sessions", "team"],
    href: "/settings/users",
  },
  {
    id: "groups",
    title: "Groups",
    category: "Administration",
    summary:
      "A group gives its roles to every member, so a team's access is managed once instead of person by person.",
    body: [
      "Permissions → Groups creates a group; give it roles and add its people. Members get the group's roles on their next request, and lose them when they leave the group.",
      "A user's page shows each role that comes “via” a group, and a role's page lists the groups that carry it.",
      "Nobody can add themselves to a group or give roles to a group they belong to, and adding people to a group that carries roles needs role-assignment rights too.",
    ],
    keywords: ["group", "groups", "team", "members", "group roles", "via group"],
    href: "/settings/groups",
  },
  {
    id: "roles-permissions",
    title: "Roles and permissions",
    category: "Administration",
    summary:
      "Access inside WonderID is role-based: system roles cover common jobs, custom roles are built from the permission catalog, and every check happens on the server.",
    body: [
      "Permissions → WonderID Roles lists system roles (Tenant Administrator, Security Administrator, Identity Administrator, Agent Administrator, Auditor, Read Only and more) and your custom roles. System roles are read-only; copy one to start a custom role.",
      "The role designer lets you pick permissions by product area. You can only include permissions you hold yourself, so nobody can create a role more powerful than they are. Custom roles can be deactivated; one in use can't be deleted.",
      "Permissions → Permission Catalog lists every permission with its resource, action, sensitivity and the roles that grant it.",
      "The interface hides what you can't do, but enforcement happens on the server for every page and action. Platform administration is a separate, vendor-only boundary no customer role can reach.",
    ],
    keywords: ["role", "roles", "permission", "rbac", "admin", "custom role", "system role", "catalog", "read only", "who can"],
    href: "/settings/roles",
  },
  {
    id: "scoped-assignments",
    title: "Scoped and time-limited role assignments",
    category: "Administration",
    summary:
      "A role assignment can apply to the whole organization or only to chosen environments, applications or agents, from and until set dates, and only in MFA sessions.",
    body: [
      "When assigning a role on a user's or group's page, open “Scope, timing and conditions”. Choose where it applies, optional start and expiry dates, and whether it needs multi-factor authentication.",
      "A scoped role applies only where WonderID checks that specific environment, application or agent — for example an agent's own page and actions. It never counts on pages that act on everything at once, so a scoped role can't widen into organization-wide access.",
      "Outside its dates an assignment is shown as “Not in effect” and grants nothing. The Tenant Administrator role is always organization-wide, permanent and unconditional.",
    ],
    keywords: ["scope", "scoped", "limit", "restrict", "environment", "production", "expiry", "expires", "temporary", "time limited", "mfa condition", "assignment"],
    href: "/settings/users",
  },
  {
    id: "authorization-policies",
    title: "Authorization policies (deny and require approval)",
    category: "Administration",
    summary:
      "Authorization policies override roles: deny an action, or hold it for approval, across the organization or in a scope, with exempt roles for break-glass access.",
    body: [
      "Permissions → Authorization Policies lists them. Pick the permissions a policy covers (or a prefix such as runtime.*), where it applies, and any exempt roles.",
      "A deny wins over every role, including administrators. A require-approval policy currently refuses the direct action and says approval is needed.",
      "Refused actions are recorded in the audit trail. A policy can never cover tenant.security.manage — the permission that manages policies — so a mistaken policy can always be undone.",
    ],
    keywords: ["authorization policy", "deny", "require approval", "break glass", "exempt", "override", "restriction", "block action"],
    href: "/settings/authorization-policies",
  },
  // ------------------------------------------------------------------- Settings
  {
    id: "sso-security",
    title: "Sign-in, SSO and security settings",
    category: "Settings",
    summary:
      "Sign in with a password, Google or SSO; add an authenticator app for MFA; sessions expire, and signing out ends your sessions everywhere.",
    body: [
      "Password sign-in, Google sign-in and domain-based SSO are available from the sign-in screen. SSO routes users whose email domain has an active connection to their identity provider.",
      "Forgot your password? Use “Forgot password?” on the sign-in screen; the emailed link lets you set a new one. Repeated reset requests are rate-limited.",
      "Authentication → Sign-in Security lets you enroll an authenticator app for multi-factor authentication. Organization-wide MFA requirements are being added.",
      "Sessions end after inactivity and after an absolute lifetime. Signing out is global by design — it ends your other sessions too. Authentication → Single Sign-On configures SAML/OIDC connections.",
    ],
    keywords: ["sso", "saml", "oidc", "google", "sign in", "login", "password", "forgot", "reset", "session", "timeout", "logout", "mfa", "authenticator", "totp"],
    href: "/settings/sso",
  },
  {
    id: "tenant-address",
    title: "Your organization's sign-in address",
    category: "Settings",
    summary:
      "Each organization can have its own address; signing in there shows your organization's name and only ever opens that organization.",
    body: [
      "Your organization's address is its short name followed by the WonderID domain. Signing in there shows “Sign in to your organization” with your name and logo.",
      "On that address you only ever see that organization, even if you belong to others; an address that doesn't exist shows a clear “not found” page rather than someone else's sign-in.",
    ],
    keywords: ["tenant url", "address", "subdomain", "slug", "custom domain", "organization url", "branded sign in"],
  },
  {
    id: "ai-provider",
    title: "AI features and provider keys",
    category: "Settings",
    summary:
      "AI summaries and suggestions are advisory only; a tenant can bring its own OpenAI or Gemini key, otherwise the deployment's platform default key is used.",
    body: [
      "AI in WonderID writes summaries and drafts proposals from data that has already been computed. It never makes an authorization, risk, policy or remediation decision.",
      "Administration → AI Assistance selects the provider and, optionally, your own API key, stored encrypted and shown masked. Without one, the platform default is used when the deployment has one.",
      "If neither exists, AI features say so rather than failing silently.",
    ],
    keywords: ["ai", "openai", "gemini", "api key", "byok", "summary", "chatbot", "assistant", "model"],
    href: "/settings/ai",
  },
  {
    id: "tenancy",
    title: "Organizations and data isolation",
    category: "Settings",
    summary:
      "Every record belongs to one organization and is isolated at the database layer — no query, search, export or AI feature crosses that boundary.",
    body: [
      "You can belong to more than one organization and switch between them from the header; what you see is always scoped to the active one.",
      "Isolation is enforced by row-level security in the database, not only by application code, so an application bug cannot leak another organization's rows.",
      "This applies everywhere, including caches, search, exports and anything sent to an AI provider.",
    ],
    keywords: ["tenant", "organization", "isolation", "multi-tenant", "switch", "workspace", "rls", "data separation"],
    href: "/settings",
  },
  // ------------------------------------------------------------------------ FAQ
  {
    id: "faq-no-findings",
    title: "Why do I have no findings?",
    category: "FAQ",
    summary:
      "Findings need both sides of a comparison: registered agents with contracts, and imported access or runtime data to compare them against.",
    body: [
      "The usual cause is agents without contracts. With no approved purpose recorded there is no SHOULD, so excessive-access and unauthorized-action checks have nothing to compare against.",
      "The other common cause is no imported data yet — check Integrations → Sync Jobs to confirm a sync actually completed.",
    ],
    keywords: ["no findings", "empty", "nothing", "missing data", "why", "blank", "not working"],
    href: "/risk",
  },
  {
    id: "faq-cant-see",
    title: "Why can't I see a page or button?",
    category: "FAQ",
    summary:
      "Your roles don't include the permission it needs, a scoped role doesn't apply there, a role has expired or needs MFA, or an authorization policy denies it.",
    body: [
      "Open your own user page (Permissions → Users) to see your roles, their scope and dates, and each effective permission with where it comes from.",
      "A refusal that names a policy, “MFA required” or “approval required” tells you exactly which rule stopped you. Ask an administrator to change your role or the policy — nobody can grant themselves access.",
    ],
    keywords: ["can't see", "cannot see", "missing button", "forbidden", "403", "not allowed", "denied", "no access", "permission denied", "mfa required"],
    href: "/settings/users",
  },
  {
    id: "faq-remediation",
    title: "Can WonderID revoke access automatically?",
    category: "FAQ",
    summary:
      "No — consequential changes require a human to initiate them, and a read-only connector cannot write at all.",
    body: [
      "WonderID recommends remediation and can hand it to your IAM workflow, but a person initiates consequential grants, revocations, policy overrides and destructive actions.",
      "This is deliberate. An autonomous system that silently revokes production access is a bigger risk than the one it is trying to manage.",
    ],
    keywords: ["remediation", "revoke", "automatic", "automation", "fix", "remove access"],
    href: "/risk",
  },
  {
    id: "faq-ai-decisions",
    title: "Does AI decide my risk scores?",
    category: "FAQ",
    summary:
      "No. Risk, policy, authorization and isolation decisions are deterministic; AI only writes summaries and proposals of results it is given.",
    body: [
      "Every score, finding and authorization decision comes from explicit rules you can trace. AI output is labelled advisory and is never read back into a decision.",
      "Turning AI off changes what the product explains, never what it decides.",
    ],
    keywords: ["ai", "llm", "deterministic", "score", "decision", "trust", "hallucination", "accuracy"],
    href: "/risk",
  },
];

export const GUIDE_CATEGORIES: GuideCategory[] = [
  "Getting started",
  "Core model",
  "Identities",
  "Agents",
  "Applications",
  "Access",
  "Runtime",
  "Risk",
  "Compliance",
  "Integrations",
  "Operations",
  "Administration",
  "Settings",
  "FAQ",
];

export function sectionsByCategory(category: GuideCategory): GuideSection[] {
  return GUIDE_SECTIONS.filter((s) => s.category === category);
}

export function getSection(id: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find((s) => s.id === id);
}
