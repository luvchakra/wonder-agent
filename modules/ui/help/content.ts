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
      "WonderID was formerly called WonderAgent, when it governed AI agents only, and that remains its deepest area: every agent gets an owner, an approved purpose, a known set of permissions and an observable record of what it actually did. People, applications, access requests and administration are now governed with the same deterministic controls.",
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
      "1. Create your organization when you first sign up, or accept the invitation waiting for you on the organization screen. Everything in WonderID is scoped to one organization — data is never shared between organizations.",
      "2. Invite your colleagues under Permissions (WonderID) → Users and give them roles (or put them in groups that carry roles).",
      "3. Add your sources under Integrations: identity sources for people (an HR export or a connected system), connectors for IAM data, and MCP runtime events.",
      "4. Review what arrived: Identities for people and machine identities, Applications for the catalog and accounts, and AI Agents → Discovery Inbox for agents found in your systems.",
      "5. Give each agent an owner and a contract — its approved applications, data and actions. That is what Approved (SHOULD) means for it.",
      "6. Open Risk & Security. Findings appear wherever access or behaviour goes beyond what was approved.",
      "Before people can request access, someone who manages access has to set a request policy — without one, nothing is requestable (see “Requesting and approving access”).",
    ],
    keywords: ["setup", "start", "onboarding", "quick start", "begin", "first", "walkthrough", "getting started"],
    href: "/",
  },
  {
    id: "home-overview",
    title: "The Home overview",
    category: "Getting started",
    summary:
      "Home summarizes your AI agents: how many there are, how many are approved, high-risk or unregistered, failed actions, the agent lifecycle, a risk trend and recent activity.",
    body: [
      "The five cards at the top count total agents, approved agents, high-risk agents (those with an open critical or high finding), unregistered agents (discovered but not yet registered) and failed actions in the period. Each card opens the page behind it.",
      "Below them: the agent lifecycle as a ring, findings detected per day by severity, the most recent agent activity and the agents with the highest risk scores.",
      "Use the reporting period at the top to switch between the last 7, 30 and 90 days. Home is about AI agents; people, applications and access requests have their own pages in the sidebar.",
    ],
    keywords: ["home", "dashboard", "overview", "summary", "kpi", "cards", "risk trend", "lifecycle ring", "top risky agents", "reporting period"],
    href: "/",
  },
  {
    id: "navigating",
    title: "Finding your way around",
    category: "Getting started",
    summary:
      "The sidebar groups WonderID by area — Identities, Applications, Access Governance, AI Agents, Risk & Security and administration — and shows only what your role can use.",
    body: [
      "The left sidebar collapses to icons; hovering a group while collapsed opens its pages. On a phone it becomes a menu drawer, with a tab bar at the bottom for Home, Agents, Discover, Risk and More.",
      "Search (the box in the header, or Ctrl+K / ⌘K) finds agents and their identity records and owners, applications, entitlements, findings, investigations, policies, certification campaigns, integrations and runtime decisions — only the kinds your role can read, and only in your organization. To find a person, use Identities.",
      "The bell in the header shows your in-app notifications. The “?” icon next to it, and Get Help in the account menu, open this guide.",
      "Light, dark or system theme is chosen under Appearance in the account menu, which also holds Settings, My privacy and Log Out.",
      "If a page or button you expect is missing, your role probably doesn't include it — see “Why can't I see a page or button?”.",
    ],
    keywords: ["navigation", "sidebar", "menu", "where is", "find", "theme", "dark mode", "light mode", "mobile", "search", "search box", "keyboard shortcut", "ctrl k", "bell", "account menu", "appearance"],
  },
  {
    id: "install-app",
    title: "Installing WonderID on a phone or tablet",
    category: "Getting started",
    summary:
      "On a phone or tablet you can add WonderID to your home screen, so approvals and findings are one tap away and it opens full screen.",
    body: [
      "Android (Chrome, Edge, Samsung Internet): when the browser can install WonderID, a banner at the top of the page offers Install; tap it and confirm. The browser menu's Install app does the same.",
      "iPhone and iPad: tap Share in the browser (under ••• if you don't see it), then Add to Home Screen. The banner's How to button shows these two steps.",
      "The installed app is the same WonderID, with the same sign-in and permissions. It needs a connection and does not send push notifications. Closing the banner hides it on that browser for 14 days; it never appears on a computer or once the app is installed.",
    ],
    keywords: ["install", "app", "home screen", "add to home screen", "mobile app", "phone", "tablet", "iphone", "ipad", "android", "pwa", "banner"],
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
      "The value is in the comparison. Access it CAN use but SHOULD not have is excessive access. Something it DID that it SHOULD not have done is a violation. An agent's Runtime (DID) tab shows all of them side by side, with the comparison's outcomes and a health badge — “Deviation detected” when they disagree, or “No approved contract” when there is no SHOULD to compare against.",
      "A fourth view, Current Request (NOW), shows the agent's most recent request to the Runtime Gateway: whether it was approved by the contract, whether effective access covers it, and the decision the gateway gave.",
    ],
    keywords: ["should", "can", "did", "now", "current request", "model", "comparison", "concept", "gap", "excessive", "difference", "deviation"],
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
      "Identities → Overview counts identities by type and lists what needs attention: open lifecycle work, machine identities without an owner, external access ending within 30 days, and external identities still active past their end date. All Identities, People, External Identities and Machine Identities each list one slice.",
      "New identity adds a person, an external person or a machine identity (service account, application account, workload or API client). An external identity needs a sponsor, an organization and a future end date; a machine identity needs an accountable owner. To add an AI agent, register it under AI Agents — its identity appears here by itself.",
      "Open an identity to see its details, source, owner or sponsor and manager, its relationships to other identities, and its attributes; people also have a Lifecycle tab. Where an identity comes from an identity source, a value owned by that source is not silently overwritten here. Changes are recorded in the audit trail.",
      "Identities → Non-human Identities is a separate inventory of the technical identities your connected sources report — service accounts, workload identities, OAuth clients, API keys and MCP server identities. Most are not AI agents, so each unlinked one shows how likely it is to be one; the views are Linked, Not linked, Likely AI agents, Orphaned and Ignored. Administration → Identity Attributes defines the extra attributes your organization tracks.",
    ],
    keywords: ["identity", "identities", "people", "person", "employee", "contractor", "external", "sponsor", "end date", "machine", "service account", "directory", "nhi", "non-human", "new identity", "orphaned", "relationships"],
    href: "/identities",
  },
  {
    id: "identity-lifecycle",
    title: "Joiners, movers and leavers",
    category: "Identities",
    summary:
      "Lifecycle Work turns joiner, mover and leaver events into tasks for a person to complete, including transferring what a leaver owned.",
    body: [
      "A person's lifecycle state is Joining, Active, Leaving, Disabled, Terminated or Archived. On their page, the Lifecycle tab offers the steps allowed from the current state — for example Start work, Start leaving, Cancel the departure, Disable, Terminate, Archive or Rehire. Leaving, Disable, Terminate and cancelling a hire ask for a reason. Changes that arrive from an identity source (a new hire, a department change, a person missing from a full import) create the same events.",
      "Each event opens tasks: a joiner gets Request baseline access; a mover or a changed employment type gets Review access; a rehire gets both; a leaver gets Transfer ownership, Revoke access and, when they have a sign-in, Disable sign-in. Identities → Lifecycle Work lists the open tasks (switch the view to include completed ones).",
      "A task is a person's job, closed with a note — completing it is how you record that the access was removed or granted. Nothing is granted or revoked automatically.",
      "Transfer ownership shows what the leaver owns, sponsors and manages (including AI agents) and hands it to a named successor; the change is audited.",
    ],
    keywords: ["joiner", "mover", "leaver", "lifecycle", "onboard", "offboard", "termination", "terminate", "rehire", "disable", "archive", "transfer ownership", "tasks", "lifecycle work", "baseline access"],
    href: "/identities/lifecycle",
  },
  {
    id: "identity-sources",
    title: "Authoritative identity sources",
    category: "Identities",
    summary:
      "Identity sources import people from an HR export or a connected system, with precedence rules when two sources disagree and a review queue for records that match more than one identity.",
    body: [
      "Integrations → Identity Sources → New source asks for a name, a source type (CSV file, SCIM, REST API, HR system API or an existing integration), which identities it provides, and how its columns map to WonderID attributes — each type suggests a mapping you can edit. Nothing is imported until you run it. Open the source to upload a CSV file, or, for an existing-integration source, to reconcile from the records that integration has already imported.",
      "Choose Full when the file or integration holds everyone — identities missing from it are treated as leavers — or Partial to touch only the records given. Tick “Preview only” first to see what would change without changing anything. Each run reports what it created, updated, left pending, flagged as leavers and rejected as invalid, and its page lists every change and problem.",
      "When two sources supply the same attribute, the one with the higher precedence wins, and the losing value is kept as provenance rather than discarded.",
      "A source record that matches more than one existing identity goes to Integrations → Pending Matches. WonderID never picks one for you: link the record to the right identity, create a new one, or dismiss it.",
    ],
    keywords: ["hr", "directory", "source of truth", "authoritative", "import people", "csv", "upload", "full import", "partial import", "preview", "dry run", "precedence", "pending matches", "reconciliation", "correlation", "ambiguous"],
    href: "/integrations/sources",
  },
  // --------------------------------------------------------------------- Agents
  {
    id: "register-agents",
    title: "Registering and owning agents",
    category: "Agents",
    summary:
      "Register an agent to bring it under governance, then assign accountable owners — unowned agents are themselves a finding.",
    body: [
      "AI Agents → Register Agent adds one manually: its name and type, purpose, environment and criticality, and optional details such as framework, model, runtime and data classification. If it looks like an agent you already have, it goes to Duplicate Review instead of being created twice. Most agents instead arrive through an integration and are registered from the Discovery Inbox.",
      "Open an agent from AI Agents → All Agents. Its page has four tabs — Overview, Access (CAN), Runtime (DID) and Risk & Findings. Overview holds the agent's information and key metrics, Approved (SHOULD) against Effective Access (CAN), a governance posture score, its lifecycle, owners, contract, relationships, linked identities and API keys.",
      "Every agent needs accountable owners. Owner types are business, technical, IAM, application, data, escalation and delegated; assign one by choosing the type and entering the person's user ID. A delegated owner can have an end date. Review ownership confirms the owners are still right. The Lifecycle card flags gaps — a missing owner, an owner who is no longer an active member, one person holding conflicting owner roles, or an expired delegation.",
      "Governance posture scores twelve dimensions, such as ownership, purpose, access, certification, runtime monitoring and human oversight, and lists which are governed and which have a gap.",
    ],
    keywords: ["register", "create agent", "owner", "ownership", "owner types", "business owner", "technical owner", "retire", "new agent", "delegated owner", "governance posture", "duplicate"],
    href: "/agents/new",
  },
  {
    id: "agent-lifecycle",
    title: "Agent lifecycle and approval",
    category: "Agents",
    summary:
      "An agent moves from Discovered to Active through recorded steps — registration, optional assessment, approval and provisioning — and can later be restricted, suspended or retired.",
    body: [
      "The states are Discovered, Registered, Assessed (optional), Approved, Provisioned, Active, Certification due, Restricted, Suspended and Retired. On an agent's Overview, the Lifecycle card shows the history; to move an agent, choose the new state, give a reason and press Transition. Every transition is recorded with who made it and why. A step that isn't allowed from the current state is refused with the reason.",
      "Registered needs a purpose, a source and both a business owner and a technical owner. Assessed and Approved need an active agent contract that hasn't expired and allows the agent's environment, and are done by one of the agent's owners or an Identity or Tenant Administrator. Approving a production agent needs an Identity or Tenant Administrator — its owner can't approve it alone. Going Active needs the contract to still fit.",
      "Certification due is set by the system when an active agent's review date passes, with a notification to its business owner (or to the organization if it has none); once the review is done, move the agent back to Active. Restricted puts an agent under tighter control. Suspension is an emergency step available from any state except Retired, for Security and Tenant Administrators. Lifting it is staged — Suspended, then Restricted, then Active — and restoring needs a Security, Identity or Tenant Administrator. Retired is final.",
    ],
    keywords: ["lifecycle", "state", "states", "discovered", "registered", "assessed", "approved", "provisioned", "active", "certification due", "restricted", "suspended", "retired", "suspend", "restore", "approve agent", "agent approval", "get approved", "production agent", "transition", "go live"],
    href: "/agents",
  },
  {
    id: "agent-contract",
    title: "Agent contracts (defining Approved (SHOULD))",
    category: "Agents",
    summary:
      "An agent contract records the approved purpose, applications, data and actions for one agent — it is the baseline every risk check compares against.",
    body: [
      "On an agent's Overview, open “Publish new contract version” in the Agent contract card: the purpose (required), approved applications, approved and prohibited data, approved and prohibited actions (for example READ and REPORT but not WRITE or DELETE), and the environments it is allowed to run in.",
      "Contracts also carry autonomy and oversight — an autonomy level from 0 (a human performs the action) to 4 (high autonomy with continuous controls), allowed tools, the actions that need human approval, required monitoring and compliance controls, approved users and delegators, and an optional expiry date.",
      "A contract is versioned: publishing a new version supersedes the previous one, and exactly one is active. An expired contract no longer counts, and an agent can't be assessed, approved or made Active without a valid one.",
      "Without a contract an agent has no SHOULD, so excessive-access and unauthorized-action findings cannot be calculated for it — its Runtime tab says “No approved contract”.",
    ],
    keywords: ["contract", "purpose", "approved", "should", "baseline", "autonomy", "autonomy level", "prohibited", "allowed tools", "expiry", "version", "human approval"],
    href: "/agents",
  },
  {
    id: "discovery",
    title: "Agent discovery and Shadow AI",
    category: "Agents",
    summary:
      "The Discovery Inbox lists agent-like identities found in your systems so you can register, link or ignore each one; activity from unregistered agents is marked Shadow AI.",
    body: [
      "Discovery looks through your connected integrations for identities that behave like AI agents and lists them in AI Agents → Discovery Inbox with the evidence and a confidence signal. Use Discover Now on a connected integration to run it straight away. The tabs narrow the list to New, Shadow AI, Needs Review, Potential Duplicates, Recently Changed or Ignored candidates.",
      "Open a candidate to see why it was identified as an agent — the reasons are rule-based and evidence-backed, never a model's guess. Register it as a governed agent, link it to one you already have, or ignore it. Ignoring is recorded, so the same candidate doesn't reappear as noise.",
      "AI Agents → Duplicate Review lists registrations that matched an agent you already have, with the match score and what matched. Merge discards the pending registration; Confirm distinct completes it as a separate agent. Runtime activity from an agent nobody registered is shown as Shadow AI — on the Discovery Inbox tab and as a banner on Risk & Security — with how many events were seen; none of it is governed until the agent is registered.",
    ],
    keywords: ["discovery", "inbox", "candidates", "unregistered", "shadow", "shadow ai", "duplicates", "duplicate review", "merge", "discover now", "ignore", "link"],
    href: "/agents/discovery",
  },
  {
    id: "agent-api-keys",
    title: "Agent API keys",
    category: "Agents",
    summary:
      "An agent authenticates to the Runtime Gateway with its own API key; the secret is shown once, can expire, and can be revoked at any time.",
    body: [
      "Open an agent and create a key in the API keys panel at the bottom of its Overview. Each key is bound to that agent and your organization. Copy the secret straight away — WonderID stores only a hash and can never show it again.",
      "Keys can carry an expiry date. Revoking one takes effect immediately. “Revoke all keys” on the same panel is the emergency version — the agent is refused on its next request with any of its keys. It asks for a reason and is available to people who can update the agent or hold the runtime emergency permission.",
    ],
    keywords: ["api key", "agent key", "token", "secret", "rotate", "revoke key", "revoke all keys", "credential", "expire"],
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
      "Each application has an owner, a type, a risk level and an onboarding status. The inventory counts applications that are active, still onboarding, missing an owner or high risk, and filters by status, type and risk. Register an application there, open it, and choose Onboarding.",
      "Onboarding has five steps: Configure (the connector its accounts and entitlements are read from, how an account is matched to an identity, its request and certification policy, and which operations the connector fulfils), Validate (checks the configuration against the onboarding checklist), Simulate (plays the configuration against the accounts the connector already imported — nothing is created, changed or removed — and counts matched, orphan, ambiguous and unidentifiable accounts), Approve and Promote.",
      "A passing simulation submits the exact version that was simulated for approval. Someone other than the person who submitted it approves; only an approved, unchanged version can be promoted, and promoting makes the application active. Change the configuration later and a new version has to be validated and approved again. A failed validation or simulation stops onboarding visibly, with the reason.",
      "Onboarding suggestions: on the onboarding page you can ask for a proposed configuration from an OpenAPI document or a sample account. It is a proposal to review — applying it only fills the draft, and AI may help draft it, but it is never applied on its own. Suspending or retiring an application needs a reason and is audited.",
      "Applications → Discovery lists applications found by connectors, API documents or people. Each is matched to the catalog; an unrecognized one waits for someone to register it, link it to an existing application, record an exception, or ignore it with a reason. Use “Discover from a connector” or “Add a discovery” to bring more in.",
    ],
    keywords: ["application", "app", "catalog", "inventory", "onboarding", "onboard application", "configure", "validate", "simulate", "approve", "promote", "unrecognized", "application discovery", "openapi", "proposal", "register application", "retire"],
    href: "/access",
  },
  {
    id: "accounts",
    title: "Accounts and data sources",
    category: "Applications",
    summary:
      "The account inventory correlates every application account to an identity and flags orphaned and dormant accounts; data sources record where sensitive data lives.",
    body: [
      "Applications → Accounts lists every account in a governed application and who it belongs to. Accounts arrive when an onboarded application's connector is reconciled. An orphan account has no owner; a dormant account hasn't been used within the window you choose (“Dormant after”); privileged accounts are counted too. Filter by view or search by account name.",
      "Applications → Data Sources records where your data lives (databases, warehouses and other stores) and how it is classified, and lets you link an entitlement to the data source it opens — every agent holding that entitlement can then reach that data, and its classification applies. That is part of what an agent CAN reach. A data source is retired, never deleted, and changes are audited.",
    ],
    keywords: ["account", "accounts", "orphan", "orphaned", "dormant", "unused", "privileged", "data source", "database", "sensitivity", "classification", "correlate", "reconciliation"],
    href: "/access/accounts",
  },
  // --------------------------------------------------------------------- Access
  {
    id: "effective-access",
    title: "Effective Access (CAN)",
    category: "Access",
    summary:
      "An agent's Access (CAN) tab computes what it can technically do today — the access graph, every grant, and the path that explains each one.",
    body: [
      "Open an agent and choose Access (CAN). The access graph draws agent → account → application or entitlement, exactly as effective access is derived. The grants table lists each grant's type, application, entitlement and data classification.",
      "Access paths matter as much as totals: the evidence link on a grant shows why the agent holds it — each step of the path — so you remove the right grant. Revoke on a grant asks for confirmation and takes the access away. You can also add a manual grant on the same tab.",
      "This is the CAN half of the model, computed from imported IAM data rather than asserted by hand. The same tab can run a policy evaluation against the agent's effective access; it is rule-based, never a model's decision.",
    ],
    keywords: ["effective", "effective access", "entitlement", "can", "path", "graph", "access graph", "grant", "revoke grant", "manual grant", "why can the agent reach", "inherited", "nested group"],
    href: "/agents",
  },
  {
    id: "access-requests",
    title: "Requesting and approving access",
    category: "Access",
    summary:
      "People request access from a catalog; each request follows its request policy through staged approvals, and nobody can decide their own request.",
    body: [
      "Access Governance → Request Access lists what can be requested. Pick an application or entitlement, say who it is for (yourself, or someone else if the policy allows it), give a justification when the policy asks for one, choose a duration within its limit and submit. What the request will meet — automatic approval, or approval by your manager and/or the owner — is shown before you submit.",
      "Access Governance → Request Policies set the terms for the organization, an application or one entitlement (the most specific wins; with no policy, nothing is requestable). A policy chooses the approval route — manager, owner, or manager and owner, in order or at the same time — how many days each approver has, and what happens after that: escalate to the access managers once and then expire, or expire. It also sets who may request for others, the longest and default duration, whether a justification is required, and a risk threshold: a policy can approve requests below the threshold automatically, and anything at or above it needs a person. A critical-risk request adds an access-manager review.",
      "Approvers decide in Access Governance → Access Requests, which has the views Waiting for you, My requests and All requests. A request's page shows its approval chain, step by step. Nobody can approve their own request, and a change to what was requested invalidates earlier approvals so they have to be given again. You can cancel your own request while it is waiting. Statuses are Waiting for approval, Approved, Rejected, Fulfilled, Cancelled and Expired.",
    ],
    keywords: ["request", "request access", "approve", "approval", "approver", "reject", "four eyes", "no self approval", "request policy", "escalation", "expire", "waiting for you", "justification", "duration", "auto approve", "access manager"],
    href: "/access/catalog",
  },
  {
    id: "access-packages",
    title: "Access packages",
    category: "Access",
    summary:
      "An access package bundles the entitlements a job needs so they can be requested, approved and assigned together, and removed together when they expire.",
    body: [
      "Access Governance → Access Packages lists the packages you are eligible to see, with their risk and who approves them. People who manage access also see a Manage view with drafts and retired packages, and can create one: what it includes, who it is for, who approves it, for how long, and how often it is certified.",
      "Open a package to see what it includes and to request it — for yourself or someone else. A package request goes through the same approval engine as any other request, and changing what a package includes means waiting requests need approval again. Once approved, each item is granted as its own work item — one that fails is shown as failed and the assignment as partly failed, rather than hidden.",
      "Access managers can also assign a package directly, without a request — for example to an AI agent. That is audited. Assignments can expire; expiry opens removal work for every item in the package, and ending an assignment early does the same.",
    ],
    keywords: ["package", "access package", "bundle", "assignment", "expiry", "provisioning", "assign directly", "partially failed", "retire package"],
    href: "/access/packages",
  },
  {
    id: "policies",
    title: "Governance policies",
    category: "Access",
    summary:
      "Governance policies express organization-wide rules that agents are evaluated against, independently of any single agent's contract.",
    body: [
      "Where a contract is per agent, a policy applies across them — for example forbidding write access to a production financial system, or requiring human approval for a class of action. Governance & Policies → Policies creates one with a category (identity, access, runtime, agent or lifecycle), an action (flag, restrict or block), a priority, and optionally what it applies to: a tool, an MCP server, an MCP tool, a data source or resource, or an action.",
      "Policies are versioned: a new policy can be saved as a draft, which has no effect until someone with the publish permission publishes it, and each publish keeps the earlier version. Rules are added on the policy's page. Exceptions are recorded with a reason, who granted them, an optional expiry, a business justification, a compensating control and the residual risk, and can be revoked.",
      "Separation of duties is a rule in an identity-category policy that lists actions one person must not both perform for the same AI agent — for example requesting and approving its access, or creating a grant. A policy whose action is Block refuses the second action and says why; otherwise it is advisory and lets it through and records the conflict in the audit trail.",
      "Policy evaluation is deterministic. Violations surface as findings in Risk & Security, and the Runtime Gateway applies the active policies when an agent asks to act. (Rules about who may use WonderID itself are Authorization policies, under Permissions (WonderID).)",
    ],
    keywords: ["policy", "policies", "rule", "violation", "guardrail", "evaluation", "publish", "draft", "exception", "flag", "restrict", "block", "priority", "separation of duties"],
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
      "Runtime events arrive from MCP observation, the Runtime Gateway and other configured sources, and build a timeline per agent of tools invoked, resources touched and actions taken. The Runtime page shows the gateway's recent authorization decisions, the emergency controls and the most recent activity; an agent's Runtime (DID) tab shows its own.",
      "In activity lists, a gateway decision is labelled as a decision — Allow, Allow restricted, Needs approval or Deny, with “(observed)” when it was only recorded — not as an action that succeeded or failed.",
      "The comparison on an agent's Runtime (DID) tab puts Approved (SHOULD), Effective Access (CAN), Observed (DID) and Current Request (NOW) side by side — usually the fastest way to explain a finding. Reports & export on the Runtime page leads to the reports.",
      "Events are de-duplicated, and anything that can't be processed is quarantined for review rather than dropped.",
    ],
    keywords: ["runtime", "activity", "events", "did", "timeline", "mcp", "observed", "behaviour", "behavior", "quarantine", "decisions"],
    href: "/runtime",
  },
  {
    id: "runtime-gateway",
    title: "The Runtime Gateway",
    category: "Runtime",
    summary:
      "Agents can ask the Runtime Gateway before acting; it decides from the agent's contract, effective access and policies. It runs in observe-only mode by default: the decision is recorded but the agent is told to go ahead.",
    body: [
      "An agent calls the gateway with its API key and the action it intends. The decision — Allow, Allow with restrictions, Require approval or Deny, with the reason — is recorded and appears under Authorization decisions on the Runtime page and in the agent's activity. The decision comes from rules, never from a model.",
      "In observe-only mode the gateway records what it would have decided without blocking anything, and the page marks those decisions “observed”. The Runtime page says so: nothing is blocked until enforcement is on for your organization. Enforcement is not a setting on any customer screen; when it is on for an organization, a Deny or Require-approval decision is returned to the agent and the organization is notified.",
      "Repeating a request id returns the same decision rather than a second one. The tenant and agent always come from the API key, never from the request body.",
    ],
    keywords: ["gateway", "runtime gateway", "enforce", "enforcement", "observe mode", "observe only", "observed", "allow", "deny", "require approval", "decision", "authorization decisions"],
    href: "/runtime",
  },
  {
    id: "emergency-controls",
    title: "Emergency controls",
    category: "Runtime",
    summary:
      "Incident responders can engage a kill switch, suspend a tool or an MCP server, or terminate a session — each with a reason, each audited, each reversible.",
    body: [
      "The Emergency controls card on the Runtime page offers four controls: a kill switch (every request from every agent in the organization is decided Deny until it is released), tool suspension, MCP server suspension and session termination. Engaging one requires a confirmation and a reason; lifting it does too.",
      "While the gateway is observe-only, the controls change the decision it records but nothing is blocked until enforcement is on, and the card says so. To cut off one agent's credentials, use Revoke all keys on that agent's API keys panel.",
      "These actions need the runtime emergency permission, which is deliberately separate from everyday agent administration.",
    ],
    keywords: ["emergency", "kill switch", "incident", "stop agent", "block", "suspend tools", "suspend tool", "mcp server suspension", "session termination", "panic"],
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
      "Risk & Security → Risk Overview (“Risks & alerts”) lists every open finding, most severe first, and a By agent table with each agent's open finding count and worst severity. Open an agent's Risk & Findings tab for the detail: severity, category, risk score, the explanation, the contributing reasons, a recommendation, and an evidence link to the specific access or event behind it.",
      "Risk scoring is deterministic and rule-driven. A language model never decides a severity or produces a finding. “Run risk evaluation now” on an agent's Risk & Findings tab re-runs the rules.",
      "Work a finding on that tab: assign it, move it through acknowledged, investigating, mitigated or exception, and resolve it as Verified fixed, Accepted risk or False positive. Accepted risk and False positive need a reason, and a false positive can be given a date after which it is re-checked. A finding can't be resolved as verified fixed while its evidence still triggers the rule.",
      "Request remediation (with a confirmation) revokes the access grants the finding's evidence names. It is a person's decision, never automatic, and the result tells you whether anything was actually revoked — some kinds of finding name no revocable grant. After the underlying access changes, re-evaluation resolves the finding if it no longer holds.",
    ],
    keywords: ["risk", "finding", "alert", "severity", "critical", "violation", "excessive access", "score", "remediation", "request remediation", "assign", "false positive", "accepted risk", "resolve", "evaluate", "evidence"],
    href: "/risk",
  },
  {
    id: "investigations",
    title: "Investigations",
    category: "Risk",
    summary:
      "An investigation groups related findings into one case with a timeline, notes and an outcome, so a team can work it to a conclusion.",
    body: [
      "Risk & Security → Investigations lists them (Active, Awaiting remediation and others) with priority and assignee. Open one from the form on that page by choosing the open findings that belong together. Assign it, add notes, and change its status; the timeline records who did what.",
      "Remediation is done from each finding's own page — an investigation only groups them. An investigation can't be resolved while any of its findings is still open.",
    ],
    keywords: ["investigation", "investigations", "case", "incident", "triage", "notes", "timeline", "assign investigation"],
    href: "/risk/investigations",
  },
  {
    id: "rogue-agents",
    title: "Rogue agent detection",
    category: "Risk",
    summary:
      "Rogue detection highlights agents with open behavioural-deviation, identity-anomaly, ownership or lifecycle findings — signs they are operating outside governance rather than merely holding too much access.",
    body: [
      "A single finding rarely means an agent is rogue. AI Agents → Rogue Agents lists the flagged agents; open one to see why it is flagged, the runtime comparison behind the behavioural findings, and who is accountable for it. Access-scope findings are on the agent's Risk & Findings tab instead.",
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
      "Campaigns ask reviewers to certify access, recording each decision with a justification and evidence for audit.",
    body: [
      "Certifications → Certification Campaigns launches a round: a name, a scope (agent, application, entitlement, privileged access or high-risk agent), an optional criticality filter, a cadence (one time, periodic or event driven) and a reviewer (you by default). The list shows how many items are pending and overdue. Open a campaign to see its items, each with the evidence a reviewer needs; the counts at the top show pending, decided, overdue and escalated items.",
      "Only the item's assigned reviewer can decide it. The decisions are Approve, Revoke, Modify, Delegate and Request information, and each needs a justification. Approve certifies the access; Revoke takes the item's access grant away after a confirmation, and Modify opens a change request for it (both need an item tied to a specific grant); Delegate hands the item to another reviewer; Request information leaves it pending. Every decision is recorded once, with who made it, when and what the evidence looked like at that moment.",
      "A reviewer who owns the agent can't approve its access without an explicit override, which is audited. Items that pass their due date are escalated to the agent's business owner (or the campaign creator) and the owner is notified.",
      "Campaigns cover AI agents' access today; reviews of people's access and of WonderID role assignments are not built yet.",
    ],
    keywords: ["certification", "campaign", "certify", "certify access", "recertify", "attestation", "review", "reviewer", "recertification", "approve", "revoke", "modify", "delegate", "request information", "overdue", "escalate", "audit", "evidence", "compliance", "control"],
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
      "Open a connector to save its credential, test the connection, run a sync and edit its field mappings. Sync runs appear under Integrations → Sync Jobs with their status and errors; a failed sync also notifies you. Integrations → MCP Servers inventories the servers, tools and resources your agents use, and marks each tool as read or write; run discovery on a server to refresh it.",
    ],
    keywords: ["integration", "connector", "saviynt", "rest", "mcp", "webhook", "sync", "sync failed", "import", "credentials", "connect", "field mapping", "test connection"],
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
      "Insights → Audit Trail records actor, target, action, time and outcome for every security-sensitive operation — including refusals, such as an action an authorization policy denied. Filter it by object type, action, actor and date range, and use Export CSV to take the entries out. The trail can't be edited (see “Audit integrity and financial compliance”).",
      "Insights → Reports has eight reports, each computed live when you open it and exportable as CSV: AI Agent Inventory, Ownership, Access Certification, Rogue Agent, Access Violation, Risk, Audit Evidence and Policy Compliance.",
      "Search (header box or Ctrl+K / ⌘K) finds records from one box, scoped to your organization and to what your role can read — see “Finding your way around”.",
    ],
    keywords: ["audit", "audit trail", "log", "report", "reports", "export", "csv", "evidence", "history", "who did", "filter"],
    href: "/audit",
  },
  {
    id: "notifications",
    title: "Notifications",
    category: "Operations",
    summary:
      "Notifications alert the right people to critical findings, approvals waiting on them, overdue certifications and failed syncs, in-app and by email when email is configured.",
    body: [
      "The bell in the header lists your in-app notifications. Administration → Notifications shows each notification type — certification due and overdue, critical finding, rogue agent, missing owner, integration failure, lifecycle expiry, runtime alert, approval required, billing alert and privacy deadline. All of them are mandatory today, so they are shown switched on and can't be turned off.",
      "In-app notifications always work; email delivery additionally needs the deployment's email provider. Without it you still get the in-app copy.",
    ],
    keywords: ["notification", "notifications", "bell", "email", "alert", "mandatory", "subscribe", "announcement"],
    href: "/settings/notifications",
  },
  // ------------------------------------------------------------- Administration
  {
    id: "users",
    title: "Users and membership",
    category: "Administration",
    summary:
      "Permissions (WonderID) → Users lists the people in your organization; add them by invitation, and suspend, reactivate, deactivate or remove them with a recorded reason.",
    body: [
      "Add user is three steps: their details (name, email, job title and department), their access (internal or external user, how they sign in — the organization default, email and password, or single sign-on only — and the roles they start with), and a review. Choose Invite, and they join when they accept the invitation, which they find on the organization screen after signing in; or Add now, and they are an active member straight away. Inviting needs the invite permission and adding needs the create permission. If email isn't configured, you're told so and they can use “Forgot password” on the sign-in page.",
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
      "Permissions (WonderID) → Groups creates a group; give it roles and add its people. Members get the group's roles on their next request, and lose them when they leave the group.",
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
      "Permissions (WonderID) → WonderID Roles lists system roles (Tenant Administrator, Security Administrator, Identity Administrator, Agent Administrator, Auditor, Read Only and more) and your custom roles. System roles are read-only; copy one to start a custom role.",
      "The role designer lets you pick permissions by product area. You can only include permissions you hold yourself, so nobody can create a role more powerful than they are. Custom roles can be deactivated; one in use can't be deleted.",
      "Permissions (WonderID) → Permission Catalog lists every permission with its resource, action, sensitivity and the roles that grant it.",
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
      "Permissions (WonderID) → Authorization Policies lists them. Pick the permissions a policy covers (or a prefix such as runtime.*), where it applies, and any exempt roles.",
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
      "Sign in with your email and password, with single sign-on, or with Google, Microsoft or LinkedIn where WonderID has switched that provider on; add an authenticator app for MFA. Sessions expire, and signing out ends your sessions everywhere.",
    body: [
      "The sign-in and sign-up pages offer email and password, “Sign in with SSO”, and Google, Microsoft and LinkedIn buttons. A Google, Microsoft or LinkedIn button works only once that provider has been enabled for WonderID. If it hasn't, the page says so (“Google sign-in is not enabled for WonderID yet”) and you can use your email and password or ask your administrator; if a sign-in is cancelled or doesn't finish, you are returned to the sign-in page with a message. On an organization's own address only email and password and SSO are offered.",
      "For SSO, type your work email first, then choose Sign in with SSO. It works for email domains that have an active connection and otherwise says “No SSO connection configured” for the domain. Only an SSO sign-in joins you to your organization automatically; Google, Microsoft and LinkedIn sign in your own account, and an administrator invites you to an organization.",
      "Forgot your password? Use “Forgot password?” on the sign-in screen; the emailed link lets you set a new one. Repeated reset requests are rate-limited.",
      "Authentication → Sign-in Security lets you enroll an authenticator app (TOTP) for multi-factor authentication, and remove it again. An administrator can require an MFA session for a particular role assignment (see “Scoped and time-limited role assignments”); organization-wide MFA requirements are not built yet.",
      "Sessions end after inactivity and after an absolute lifetime; you are told “Your session expired” and asked to sign in again. Signing out is global by design — it ends your other sessions too. Authentication → Single Sign-On is where administrators add a SAML or OIDC connection for an email domain; a new connection does not grant access by itself.",
    ],
    keywords: ["sso", "single sign-on", "saml", "oidc", "google", "microsoft", "azure", "linkedin", "social sign in", "not enabled", "sign in", "sign up", "login", "password", "forgot", "reset", "session", "expired", "timeout", "logout", "mfa", "authenticator", "totp"],
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
      "The “Ask the guide” box on this page answers only from this guide and links the sections it used. Signed out, or without an AI provider for your organization, it shows the matching guide text itself and says it is not AI-generated.",
    ],
    keywords: ["ai", "openai", "gemini", "api key", "byok", "summary", "chatbot", "assistant", "ask the guide", "model"],
    href: "/settings/ai",
  },
  {
    id: "billing",
    title: "Billing: plans, payment and invoices",
    category: "Settings",
    summary:
      "Choose or change your plan in Administration → Billing; you pay on Stripe's or Razorpay's secure page and WonderID never sees card or bank details.",
    body: [
      "Billing shows your plan, its status, your usage against the plan's limits, and your invoices. Viewing needs the View billing permission; choosing a plan, paying, cancelling or changing billing details needs Manage billing.",
      "Add your billing details first: the legal entity to invoice, its country and, for tax, a GSTIN (India) or VAT number (EU/UK). Indian prices include 18% GST; invoices show CGST and SGST for a supply within the supplier's state, or IGST otherwise, and carry a consecutive invoice number.",
      "Payments in Indian rupees go through Razorpay (cards, UPI, net banking and RBI e-mandates); US dollars and euros go through Stripe. After paying, your plan changes as soon as the provider confirms the payment, usually within a minute. If online payment isn't set up for your deployment, the page says so and points you to your WonderID account team.",
      "Cancelling takes effect at the end of the period you have paid for; nothing is deleted and the organization then moves to the Free plan's limits. Refunds and other adjustments are made by WonderID staff and need two people to approve.",
    ],
    keywords: ["billing", "payment", "pay", "stripe", "razorpay", "invoice", "gst", "gstin", "vat", "plan", "upgrade", "subscription", "cancel", "refund", "upi", "card"],
    href: "/settings/billing",
  },
  {
    id: "privacy",
    title: "Privacy: GDPR and DPDP",
    category: "Compliance",
    summary:
      "Privacy & Data Protection runs your GDPR and DPDP obligations: rights requests on statutory deadlines, records of processing, consent, retention, legal holds and breach notification.",
    body: [
      "Rights requests: members raise them on My privacy, or privacy staff log ones received by email or post. Each gets its legal deadline from receipt — one month under GDPR (extendable once by up to two more), 90 days under DPDP, 45 under CCPA — and reminders as it nears. Identity is verified before anything is released or deleted.",
      "Erasure is prepared by one person and approved by another; approving removes the person from the organization and pseudonymises their identity records, consents and earlier requests. The audit trail is kept unchanged, as the law allows for records kept under a legal obligation.",
      "Records of processing (GDPR Art. 30), consent purposes with notice versions, retention periods for each kind of data, and legal holds that stop retention deleting anything they cover are all on the same screen.",
      "The breach register starts the statutory clocks at detection: notify the supervisory authority within 72 hours under GDPR unless a risk is unlikely, and under DPDP intimate the Data Protection Board and every affected person without delay, with a detailed report within 72 hours.",
    ],
    keywords: ["gdpr", "dpdp", "privacy", "data subject", "data principal", "dsar", "erasure", "right to be forgotten", "consent", "breach", "retention", "dpo", "grievance", "ropa", "legal hold"],
    href: "/settings/privacy",
  },
  {
    id: "my-privacy",
    title: "My privacy: your own data",
    category: "Settings",
    summary:
      "Every member can download their data, give or withdraw consent, and raise a privacy request from My privacy in the account menu.",
    body: [
      "Download my data gives you a machine-readable copy of what your organization holds about you in WonderID.",
      "Consents can be withdrawn with one click, as easily as they were given. Requests show the date by which your organization must answer.",
    ],
    keywords: ["my data", "download", "export", "consent", "withdraw", "personal data", "privacy request"],
    href: "/my-privacy",
  },
  {
    id: "audit-integrity",
    title: "Audit integrity and financial compliance",
    category: "Compliance",
    summary:
      "The audit trail is append-only and hash-chained; Audit Integrity verifies that no entry was changed, removed or reordered, for SOX, PCI DSS and similar audits.",
    body: [
      "No one, including WonderID's own service, can edit an audit entry; the platform refuses it. Entries leave only through the retention purge, which never touches the last year or anything under a legal hold.",
      "Each entry carries a SHA-256 hash of its content linked to the entry before it, so any tampering breaks the chain at a specific entry. Audit Integrity checks the whole chain when you open it and records that check.",
      "Control libraries for SOX IT general controls, SOC 1, PCI DSS, GLBA, DORA, RBI, SEBI CSCRF and CERT-In sit alongside ISO 27001, SOC 2 and the AI frameworks. Mapping controls and attaching evidence supports your auditors; it does not by itself make an organization compliant.",
    ],
    keywords: ["sox", "sarbanes", "audit", "tamper", "immutable", "append only", "protected", "hash chain", "integrity", "pci", "itgc", "soc 1", "financial", "rbi", "sebi", "dora", "evidence"],
    href: "/audit/integrity",
  },
  {
    id: "tenancy",
    title: "Organizations and data isolation",
    category: "Settings",
    summary:
      "Every record belongs to one organization and is isolated where it is stored — no query, search, export or AI feature crosses that boundary.",
    body: [
      "You can belong to more than one organization and switch between them from the header; what you see is always scoped to the active one.",
      "Isolation is enforced where the data is stored, not only by the screens and application code in front of it, so a bug in a page cannot leak another organization's records.",
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
      "The other common cause is no imported data yet — check Integrations → Sync Jobs to confirm a sync actually completed. Open an agent's Risk & Findings tab and choose “Run risk evaluation now” to re-run the rules for it.",
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
      "Open your own user page, under Permissions (WonderID) → Users, to see your roles, their scope and dates, and each effective permission with where it comes from.",
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
      "WonderID recommends remediation, but a person initiates consequential grants, revocations, policy overrides and destructive actions — for example Request remediation on a finding, Revoke on a grant, or a Revoke decision in a certification campaign, each after a confirmation. Expiry of a package assignment opens removal work for a person; it doesn't remove anything by itself.",
      "The one place access can be approved without a person is a request policy an administrator has set to approve low-risk requests automatically, below a risk threshold they choose.",
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
  {
    id: "faq-something-wrong",
    title: "Something isn't working — what should I do?",
    category: "FAQ",
    summary:
      "Start with the message on the screen; most failures name the rule or the step that stopped you. Your organization's administrator can fix access, and the WonderID team can be emailed from this page.",
    body: [
      "Can't sign in: a Google, Microsoft or LinkedIn button that says the provider “is not enabled” means it hasn't been switched on — use your email and password. “Your session expired” means sign in again. A message that your organization is suspended means sign-in is paused; contact your administrator. “Forgot password?” sends a link to set a new one.",
      "A page or button is missing, or an action is refused: see “Why can't I see a page or button?”. The refusal names the rule — a policy, “MFA required” or “approval required”.",
      "An import or sync didn't work: for a connector, open Integrations → Sync Jobs and the connector's page; for an identity source, open the run — it lists the records that couldn't be used and why, and a preview run changes nothing. A failed sync also sends a notification.",
      "An access request is stuck: open it from Access Governance → Access Requests. Its approval chain shows who is deciding now, which steps timed out or were invalidated by a change, and you can cancel your own request while it waits and submit it again.",
      "Request remediation changed nothing: the result says whether any grant was revoked. Some findings name no access WonderID can revoke; remove the access in the system that grants it, then run the risk evaluation again.",
      "Still stuck: ask your organization's administrator first — they can see your roles and live sessions on your user page. To reach the WonderID team, use the email link at the bottom of this page.",
    ],
    keywords: ["help", "support", "contact", "error", "not working", "broken", "problem", "troubleshoot", "stuck", "failed", "cannot sign in", "can't log in", "sync failed", "import failed", "who do I ask"],
  },
  {
    id: "faq-assistant",
    title: "How does the “Ask the guide” box work?",
    category: "FAQ",
    summary:
      "It looks up the guide sections that match your question and answers from them, with links to those sections; it never invents a page or a feature.",
    body: [
      "The sections it uses are chosen by plain keyword matching, not by a model, and the links under an answer are exactly those sections.",
      "If your organization has an AI provider configured and you are signed in, a model may phrase the answer from those sections only. Otherwise — and always when you are signed out — you get the section's own summary, marked “not AI-generated”.",
      "If the guide doesn't cover your question it says so instead of guessing.",
    ],
    keywords: ["ask the guide", "assistant", "help assistant", "chatbot", "search the guide", "how does the assistant work"],
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
