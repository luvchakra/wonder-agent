/**
 * The WonderID user guide, as structured data rather than prose pages.
 *
 * Structured because two surfaces read it: `/help` renders it, and the help
 * assistant (`lib/ai/helpAnswer.ts`) retrieves against it. Keeping one
 * source means an answer can never cite a section that does not exist —
 * the assistant picks from these entries and links their anchors, rather
 * than inventing a link.
 *
 * Content rule: describe only what is actually built, in the UI's own words
 * (menu paths as the sidebar shows them, exact button labels). Never describe
 * a planned feature as available. A change that adds, removes or renames a
 * user-facing feature updates the section here in the same pull request and
 * sets its `updated` date (CLAUDE.md §19.7); `links.test.ts` fails when a
 * section links to a page or section that no longer exists.
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
  /** When this section was last checked against the app (YYYY-MM-DD); shown as "Last updated". */
  updated: string;
};

export const GUIDE_SECTIONS: GuideSection[] = [
  // ------------------------------------------------------------ Getting started
  {
    id: "what-is-wonderid",
    title: "What WonderID is",
    category: "Getting started",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "Create an organization, invite your team, bring in identities and access from your source systems, give agents an owner and a contract, then review the findings.",
    body: [
      "1. Create your organization when you first sign up, or accept the invitation waiting for you on the organization screen. Everything in WonderID is scoped to one organization; data is never shared between organizations.",
      "2. Invite your colleagues under Administration › Users & Roles › Users and give them ID roles, or put them in groups that carry roles.",
      "3. Connect your systems under Administration › Integrations: Authoritative Sources for people (an HR export or a connected system), Connections for applications and identity providers, and MCP servers for agent activity.",
      "4. Review what arrived: Administration › Identities for people, external and non-human identities and accounts, Administration › Applications › Application Catalog for applications, and AI Agents › Agent Discovery for agents found in your systems.",
      "5. Give each agent an owner and a contract: its approved applications, data and actions. That is what Approved (SHOULD) means for it.",
      "6. Open Risk & Detection › Risk Dashboard. Findings appear wherever access or behaviour goes beyond what was approved, and Rogue Accounts lists access nothing in WonderID explains.",
      "Before people can request access, someone who manages access has to set a request policy. Without one, nothing is requestable (see “Requesting and approving access”).",
    ],
    keywords: ["setup", "start", "onboarding", "quick start", "begin", "first", "walkthrough", "getting started"],
    href: "/",
  },
  {
    id: "home-overview",
    title: "The Home overview",
    category: "Getting started",
    updated: "2026-10-16",
    summary:
      "Home (the Security Overview) summarizes the whole organization: identities, lifecycle work, applications, orphaned and rogue accounts, waiting requests and open reviews, then your AI agents.",
    body: [
      "The first row counts Identities, Lifecycle work open, Live applications, Orphaned accounts, Requests waiting, Rogue accounts and Review items open. Each opens the page behind it.",
      "The agent cards count total agents, approved agents, high-risk agents (with an open critical or high finding), unregistered agents (discovered but not yet registered) and failed actions in the period. Below them: the agent lifecycle as a ring, findings per day by severity, recent agent activity and the agents with the highest risk scores.",
      "Use the reporting period at the top to switch between the last 7, 30 and 90 days. Every number is counted from your organization's own records.",
    ],
    keywords: ["home", "dashboard", "overview", "summary", "kpi", "cards", "risk trend", "lifecycle ring", "top risky agents", "reporting period"],
    href: "/",
  },
  {
    id: "navigating",
    title: "Finding your way around",
    category: "Getting started",
    updated: "2026-10-16",
    summary:
      "The sidebar lists WonderID's areas: Home, My Workspace, Access, AI Agents, Access Reviews, Risk & Detection, Self Service and Administration. Each opens its own menu, and you only see what your roles can use.",
    body: [
      "Choose an area to open its menu; the arrow at the top goes back to the list of areas. A page always opens with its own area's menu, and the page you are on is marked.",
      "My Workspace is your own work: My Requests, Approvals, My Tasks, My Team, My Privacy and Sign-in Security. Access is for requesting and managing access: Request Access, All Requests, Provisioning Tasks, Access Packages, Entitlements and Request Policies. AI Agents holds the Agent Inventory, Agent Discovery, Duplicate Review, Agent Identities and Agent Activity. Access Reviews has Create Campaigns and Review Campaigns. Risk & Detection has the Risk Dashboard, Rogue Accounts, Rogue Agents, SoD Violations and Investigations. Self Service is where you Onboard Application or Register Agent.",
      "Administration is always last and opens its own menu: Identities, Applications, Policies & Controls, Reports & Audit, Users & Roles, Integrations, Organization Settings, and Privacy & Audit.",
      "The search box at the top of the sidebar finds menu items only (type “sync” to find Sync Jobs, with where it lives). To search your data, use the box in the header, or Ctrl+K / ⌘K: it finds agents, owners, applications, entitlements, findings, investigations, policies, campaigns, integrations and runtime decisions that your roles can read, in your organization. To find a person, use Administration › Identities.",
      "The toggle at the top right of the sidebar collapses it to a strip of icons: the toggle, a search icon that opens the sidebar into its search box, then one icon per area. WonderID remembers your choice. On a phone the sidebar is a drawer, opened by the round More button at the bottom right. The sidebar's footer shows the WonderID version, and its foot holds the organization switcher.",
      "Under its title, every record's page says who created it and when, and who last changed it and when. Records from before this was recorded show the date alone. Many lists have an Actions menu with Export CSV, and Import CSV… where records can be imported, with a preview before anything is added.",
      "The bell in the header shows your notifications. The account menu holds Settings, My privacy, WonderID AI (the assistant on this page), Get Help (this guide), Install the app, Appearance (light, dark or system theme) and Log Out.",
      "If a page or button you expect is missing, your roles probably don't include it. See “Why can't I see a page or button?”.",
    ],
    keywords: ["navigation", "sidebar", "menu", "where is", "find", "area", "areas", "collapse", "hamburger", "admin", "intelligence", "onboarding", "control center", "sod", "menu search", "version", "theme", "dark mode", "light mode", "mobile", "search", "keyboard shortcut", "ctrl k", "bell", "account menu", "appearance", "created by", "updated by", "who changed"],
  },
  {
    id: "install-app",
    title: "Installing WonderID on a phone or tablet",
    category: "Getting started",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
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
    updated: "2026-10-17",
    summary:
      "Identities lists every governed identity — people, external identities, machine identities and AI agents — with its type, status, owner and source.",
    body: [
      "Administration › Identities › Identity Overview counts identities by type and lists what needs attention: open lifecycle work, non-human identities without an owner, external access ending within 30 days, and external identities still active past their end date. All Identities, Workforce, External Identities and Non-Human Identities each list one slice.",
      "New identity adds a person, an external person or a non-human identity (service account, application account, workload or API client). An external identity needs a sponsor, an organization and a future end date; a non-human identity needs an accountable owner. Orphaned Identities lists the non-human identities nobody owns; access can't be requested for them until they have an owner. To add an AI agent, register it under Self Service › Register Agent; its identity appears here by itself.",
      "Open an identity to see its details, source, owner or sponsor and manager, its relationships to other identities, and its attributes; people also have a Lifecycle tab. A value owned by an identity source is not silently overwritten here. Changes are recorded in the audit trail.",
      "Two records of the same person can be merged. When another record has the same email or name, the person's page says \"Possible duplicate\"; Compare and merge shows both side by side. Where they differ, choose which value stays; a blank takes the other value. Merge records moves the other record's accounts and access, its access packages, pending requests, open findings, direct reports, source records and WonderID sign-in to this record, and sets the other inactive. History stays with the record it happened to. Undo the merge, on either record, puts everything back and needs a reason. Two records that both sign in, hold the same package, or come from the same identity source can't be merged.",
      "AI Agents › Agent Identities is a separate inventory of the technical identities your connected sources report: service accounts, workload identities, OAuth clients, API keys and MCP server identities. Most are not AI agents, so each unlinked one shows how likely it is to be one. Administration › Organization Settings › Identity Attributes defines the extra attributes your organization tracks.",
    ],
    keywords: ["identity", "identities", "people", "person", "employee", "contractor", "external", "sponsor", "end date", "machine", "service account", "directory", "nhi", "non-human", "new identity", "orphaned", "relationships", "merge", "duplicate", "undo merge"],
    href: "/identities",
  },
  {
    id: "identity-lifecycle",
    title: "Joiners, movers and leavers",
    category: "Identities",
    updated: "2026-10-16",
    summary:
      "Joiner-Mover-Leaver turns joiner, mover and leaver events into tasks for a person to complete, including transferring what a leaver owned.",
    body: [
      "A person's lifecycle state is Joining, Active, Leaving, Disabled, Terminated or Archived. On their page, the Lifecycle tab offers the steps allowed from the current state, for example Start work, Start leaving, Cancel the departure, Disable, Terminate, Archive or Rehire. Leaving, Disable, Terminate and cancelling a hire ask for a reason. Changes that arrive from an identity source (a new hire, a department change, a person missing from a full import) create the same events.",
      "Each event opens tasks: a joiner gets Request baseline access; a mover or a changed employment type gets Review access; a rehire gets both; a leaver gets Transfer ownership and, when they have a sign-in, Disable sign-in. Administration › Identities › Joiner-Mover-Leaver lists the open tasks (switch the view to include completed ones).",
      "When someone actually stops working (disabled, terminated or archived), each access they hold becomes its own removal task under Provisioning Tasks, due within a day, or is removed by a connection that can make the change. Approved access that was never set up is withdrawn. Removal counts as done only when a later sync no longer finds the access.",
      "Transfer ownership shows what the leaver owns, sponsors and manages (including AI agents) and hands it to a named successor; the change is audited.",
    ],
    keywords: ["joiner", "mover", "leaver", "lifecycle", "onboard", "offboard", "termination", "terminate", "rehire", "disable", "archive", "transfer ownership", "tasks", "lifecycle work", "baseline access"],
    href: "/identities/lifecycle",
  },
  {
    id: "identity-sources",
    title: "Authoritative identity sources",
    category: "Identities",
    updated: "2026-10-16",
    summary:
      "Identity sources import people from an HR export or a connected system, with precedence rules when two sources disagree and a review queue for records that match more than one identity.",
    body: [
      "Administration › Integrations › Authoritative Sources › New source asks for a name, a source type (CSV file, SCIM, REST API, HR system API or an existing connection), which identities it provides, and how its columns map to WonderID attributes. Each type suggests a mapping you can edit. Nothing is imported until you run it. A source read from a connection can run by hand, daily or hourly.",
      "Choose Full when the file or connection holds everyone (identities missing from it are treated as leavers) or Partial to touch only the records given. Tick “Preview only” first to see what would change without changing anything. A full run that would mark more people as leavers than the source's limit allows waits for a person instead. Each run reports what it created, updated, left pending, flagged as leavers and rejected, and its page lists every change and problem.",
      "When two sources supply the same attribute, the one with the higher precedence wins, and the losing value is kept as provenance rather than discarded.",
      "A source record that matches more than one existing identity goes to Administration › Identities › Identity Matching. WonderID never picks one for you: link the record to the right identity, create a new one, or dismiss it.",
    ],
    keywords: ["hr", "directory", "source of truth", "authoritative", "import people", "csv", "upload", "full import", "partial import", "preview", "dry run", "precedence", "pending matches", "reconciliation", "correlation", "ambiguous"],
    href: "/integrations/sources",
  },
  {
    id: "identity-rules",
    title: "Identity rules",
    category: "Identities",
    updated: "2026-10-17",
    summary:
      "Identity rules set a person's attributes, open a task about them, add them to a group or assign them an access package, when they are created, imported, change or reach a lifecycle moment.",
    body: [
      "Administration › Organization Settings › Identity Rules lists them. A rule says when it runs (when an identity is created, imported or an attribute changes, or when a person becomes active, moves, gets a new manager, leaves or reaches their end date), which identities it applies to, and what it does: set one attribute, open a task for the person's manager or the identity administrators, add to a group, or assign an access package.",
      "Add to a group and Assign an access package give access, so each says how: “A person approves each one” opens an approval task on the lifecycle tasks page, where Approve gives the access and Reject needs a reason; “Automatic” gives it as soon as the rule fires. Nobody approves a grant for themselves. Adding to a group needs the person to have a sign-in; otherwise the run log says it was skipped.",
      "A new rule starts in report-only mode, so its run log shows what it would have done without changing anything. Someone other than its author publishes it, and it changes identities only once it is switched to enforce. A rule never overrides a value a connected source set.",
    ],
    keywords: ["identity rules", "attribute rules", "derive", "calculated attribute", "birthright", "automation", "report only", "enforce", "publish", "add to group", "assign package", "automatic grant", "approve grant"],
    href: "/identities/rules",
  },
  // --------------------------------------------------------------------- Agents
  {
    id: "register-agents",
    title: "Registering and owning agents",
    category: "Agents",
    updated: "2026-10-16",
    summary:
      "Register an agent to bring it under governance, then assign accountable owners — unowned agents are themselves a finding.",
    body: [
      "Self Service › Register Agent adds one by hand: its name and type, purpose, environment and criticality, and optional details such as framework, model, runtime and data classification. If it looks like an agent you already have, it goes to Duplicate Review instead of being created twice. Most agents instead arrive through a connection and are registered from Agent Discovery.",
      "Open an agent from AI Agents › Agent Inventory. Its page has four tabs: Overview, Access (CAN), Runtime (DID) and Risk & Findings. Overview holds the agent's information and key metrics, Approved (SHOULD) against Effective Access (CAN), a governance posture score, its lifecycle, owners, contract, relationships, linked identities and API keys.",
      "Every agent needs accountable owners. Owner types are business, technical, IAM, application, data, escalation and delegated; assign one by choosing the type and the person. A delegated owner needs an end date. Confirm ownership records that the owners are still right. The Lifecycle card flags gaps: a missing owner, an owner who is no longer an active member, one person holding conflicting owner roles, or an expired delegation.",
      "Governance posture scores twelve dimensions, such as ownership, purpose, access, certification, runtime monitoring and human oversight, and lists which are governed and which have a gap.",
    ],
    keywords: ["register", "create agent", "owner", "ownership", "owner types", "business owner", "technical owner", "retire", "new agent", "delegated owner", "governance posture", "duplicate"],
    href: "/agents/new",
  },
  {
    id: "agent-lifecycle",
    title: "Agent lifecycle and approval",
    category: "Agents",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "The Discovery Inbox lists agent-like identities found in your systems so you can register, link or ignore each one; activity from unregistered agents is marked Shadow AI.",
    body: [
      "Discovery looks through your connections for identities that behave like AI agents and lists them in AI Agents › Agent Discovery with the evidence and a confidence signal. Use Discover Now on a connection to run it straight away. The tabs narrow the list to New, Shadow AI, Needs Review, Potential Duplicates, Recently Changed or Ignored candidates.",
      "Open a candidate to see why it was identified as an agent. The reasons are rule-based and backed by evidence, never a model's guess. Register it as a governed agent, link it to one you already have, or ignore it. Ignoring is recorded, so the same candidate doesn't come back as noise.",
      "AI Agents › Duplicate Review lists registrations that matched an agent you already have, with the match score and what matched. Merge discards the pending registration; Confirm distinct completes it as a separate agent. Runtime activity from an agent nobody registered is shown as Shadow AI, on Agent Discovery and as a banner on the Risk Dashboard, with how many events were seen; none of it is governed until the agent is registered.",
    ],
    keywords: ["discovery", "inbox", "candidates", "unregistered", "shadow", "shadow ai", "duplicates", "duplicate review", "merge", "discover now", "ignore", "link"],
    href: "/agents/discovery",
  },
  {
    id: "agent-api-keys",
    title: "Agent API keys",
    category: "Agents",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "Administration › Applications › Application Catalog lists every application you govern; new ones are onboarded step by step before they go live.",
    body: [
      "Each application has an owner, a type, a risk level and an onboarding status. The catalog counts applications that are active, still onboarding, missing an owner or high risk, and filters by status, type and risk. Onboarding Reviews lists those still onboarding. Start a new one from Self Service › Onboard Application, then open it and choose Onboarding.",
      "Onboarding has five steps: Configure (the connection its accounts and entitlements are read from, how an account is matched to an identity, its request and certification policy, and which operations the connection fulfils), Validate (checks the configuration against the onboarding checklist), Simulate (plays the configuration against the accounts already imported; nothing is created, changed or removed), Approve and Promote.",
      "A passing simulation submits the exact version that was simulated. Someone other than the person who submitted it approves; only an approved, unchanged version can be promoted, and promoting makes the application active. Change the configuration later and the new version is validated and approved again. A failed validation or simulation stops onboarding with the reason.",
      "Onboarding Templates keeps starting defaults per connection type: owners, entitlement types and a questionnaire, so applications of that kind are onboarded the same way. On the onboarding page you can also ask for a proposed configuration from an OpenAPI document or a sample account. It is a proposal, AI may help draft it, and applying it only fills the draft; it is never applied on its own.",
      "Administration › Applications › Discovered Applications lists applications found by connections, API documents or people. An unrecognized one waits for someone to register it, link it to an existing application, record an exception, or ignore it with a reason. Suspending or retiring an application needs a reason and is audited.",
    ],
    keywords: ["application", "app", "catalog", "inventory", "onboarding", "onboard application", "configure", "validate", "simulate", "approve", "promote", "unrecognized", "application discovery", "openapi", "proposal", "register application", "retire"],
    href: "/access",
  },
  {
    id: "accounts",
    title: "Accounts and data sources",
    category: "Applications",
    updated: "2026-10-16",
    summary:
      "The account inventory correlates every application account to an identity and flags orphaned and dormant accounts; data sources record where sensitive data lives.",
    body: [
      "Administration › Identities › Accounts lists every account in a governed application and who it belongs to. Accounts arrive when an application's connection is synced. An orphan account has no owner; a dormant account hasn't been used within the window you choose (“Dormant after”, which starts from your organization's Governance Settings); privileged accounts are counted too.",
      "Access › Entitlements lists every entitlement in every application, 50 to a page, with its application, privilege level and data classification. An entitlement is changed on its application's page. Administration › Organization Settings › Classification Rules classifies entitlements as they arrive (privilege, data classification, whether they can be requested); a rule is published by a second person and never changes a value a person set.",
      "Administration › Applications › Data Sources records where your data lives (databases, warehouses and other stores) and how it is classified, and links an entitlement to the data source it opens. Every agent holding that entitlement can then reach that data, and its classification applies; that is part of what an agent CAN reach. A data source is retired, never deleted, and changes are audited.",
    ],
    keywords: ["entitlement", "entitlements", "all entitlements", "account", "accounts", "orphan", "orphaned", "dormant", "unused", "privileged", "data source", "database", "sensitivity", "classification", "correlate", "reconciliation"],
    href: "/access/accounts",
  },
  // --------------------------------------------------------------------- Access
  {
    id: "effective-access",
    title: "Effective Access (CAN)",
    category: "Access",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "People request access from a catalog; each request follows its request policy through staged approvals, and nobody can decide their own request.",
    body: [
      "Access › Request Access lists what can be requested. Pick an application, entitlement or package, say who it is for (yourself, or someone else if the policy allows it), give a justification when the policy asks for one, choose a duration within its limit and submit. What the request will meet, automatic approval or approval by your manager and/or the owner, is shown before you submit. Several at once asks for several items for one or more people in one go, or the same access a colleague has; each line becomes its own request, and you can save it as a draft.",
      "Access › Request Policies set the terms for the organization, an application or one entitlement (the most specific wins; with no policy, nothing is requestable). A policy chooses the approval route (manager, owner, or both, in order or at the same time), how many days each approver has and what happens after that, who may request for others, the longest and default duration, and whether a justification is required. A policy can approve requests below a risk threshold automatically; high-risk access always needs a person, and a critical-risk request adds an access-manager review. A change to a request policy takes effect only once someone other than the proposer approves it.",
      "Approvers decide under My Workspace › Approvals; your own requests are under My Requests, and Access › All Requests lists everyone's for those who manage access. A request's page shows its approval chain step by step. Nobody can approve their own request, and a change to what was requested means earlier approvals have to be given again. You can cancel your own request while it waits. Statuses are Waiting for approval, Approved, Rejected, Fulfilled, Cancelled and Expired.",
      "Approved access is then set up by the application's connection, or by a person as a provisioning task (see “Provisioning tasks”). It counts as done only once a sync finds it on the target.",
    ],
    keywords: ["request", "request access", "approve", "approval", "approver", "reject", "four eyes", "no self approval", "request policy", "escalation", "expire", "waiting for you", "justification", "duration", "auto approve", "access manager"],
    href: "/access/catalog",
  },
  {
    id: "fulfilment",
    title: "Provisioning tasks",
    category: "Access",
    updated: "2026-10-16",
    summary:
      "Approved access that no connection sets up becomes a task for a person or a group: claim it, make the change, mark it Done or Failed. It closes when the next sync finds the access.",
    body: [
      "My Workspace › My Tasks lists the tasks assigned to you or your groups; Access › Provisioning Tasks lists every task, with a workload view of who has what. An application (or one of its entitlement types) names the person or group its tasks go to.",
      "Claim a task, make the change in the target system, then choose Done (with an optional note) or Failed (saying what failed). A task can be reassigned with a reason. Tasks are due a set time after approval, from Governance Settings; removals are due within a day, and overdue tasks remind their owner daily.",
      "Done is your record of the change, not proof of it: the task closes when the next sync finds the access on the target (or no longer finds removed access).",
    ],
    keywords: ["fulfilment", "fulfillment", "provisioning", "tasks", "my tasks", "claim", "done", "failed", "reassign", "workload", "manual provisioning"],
    href: "/access/fulfilment",
  },
  {
    id: "delegations",
    title: "Delegations and My Team",
    category: "Access",
    updated: "2026-10-16",
    summary:
      "Hand your approvals or your requests to a colleague while you are away, and see your direct reports under My Team.",
    body: [
      "On My Workspace › Approvals, Delegate your approvals hands your approvals, or your requests, to someone until a date. They act on your behalf, every decision records both of you, and either of you (or an access manager) can end it. Nobody decides a request they made or that is for them.",
      "My Workspace › My Team lists the people who report to you. Under Disable all access, with a reason, a manager can stop a direct report's access in an emergency: the person is disabled and every access they hold becomes removal work. It is audited.",
    ],
    keywords: ["delegate", "delegation", "out of office", "away", "on behalf", "my team", "direct reports", "manager", "disable all access"],
    href: "/access/delegations",
  },
  {
    id: "access-packages",
    title: "Access packages",
    category: "Access",
    updated: "2026-10-16",
    summary:
      "An access package bundles the entitlements a job needs so they can be requested, approved and assigned together, and removed together when they expire.",
    body: [
      "Access › Access Packages lists the packages you are eligible to see, with their risk and who approves them. People who manage access also see a Manage view with drafts and retired packages, and can create one: what it includes, who it is for, who approves it, for how long, and how often it is certified.",
      "Open a package to see what it includes and to request it, for yourself or someone else. A package request goes through the same approvals as any other request, and changing what a package includes means waiting requests need approval again. Once approved, each item is set up as its own piece of work; one that fails is shown as failed and the assignment as partly failed, rather than hidden.",
      "Access managers can also assign a package directly, without a request, for example to an AI agent. That is audited. Assignments can expire; expiry opens removal work for every item in the package, and ending an assignment early does the same.",
    ],
    keywords: ["package", "access package", "bundle", "assignment", "expiry", "provisioning", "assign directly", "partially failed", "retire package"],
    href: "/access/packages",
  },
  {
    id: "policies",
    title: "Governance policies",
    category: "Access",
    updated: "2026-10-17",
    summary:
      "Governance policies express organization-wide rules that agents are evaluated against, independently of any single agent's contract.",
    body: [
      "Where a contract is per agent, a policy applies across them, for example forbidding write access to a production financial system or requiring human approval for a class of action. Administration › Policies & Controls › Governance Policies creates one with a category (identity, access, runtime, agent or lifecycle), an action (flag, restrict or block), a priority, and optionally what it applies to: a tool, an MCP server, an MCP tool, a data source or resource, or an action.",
      "Policies are versioned: a new policy can be saved as a draft, which has no effect until someone with the publish permission publishes it, and each publish keeps the earlier version. Rules are added on the policy's page. Exceptions are recorded with a reason, who granted them, an optional expiry, a business justification, a compensating control and the residual risk, and can be revoked.",
      "Separation of duties is a rule in an identity-category policy that lists actions one person must not both perform for the same AI agent, for example requesting and approving its access. A policy whose action is Block refuses the second action and says why; otherwise the action goes through and the conflict is recorded.",
      "Policy evaluation is deterministic. Violations surface as findings on the Risk Dashboard, and the Runtime Gateway applies the active policies when an agent asks to act. (Rules about who may use WonderID itself are Authorization Policies, under Users & Roles.)",
      "Every change to a policy, including adding a rule, is saved as a new version and takes effect at once. Change history on the policy's page lists each version, who made it, when, and what changed, for example \"Rule added: separation of duties: request vs approve\" or \"Action: block → flag\".",
    ],
    keywords: ["policy", "policies", "rule", "violation", "guardrail", "evaluation", "publish", "draft", "exception", "flag", "restrict", "block", "priority", "separation of duties", "history", "version", "change history"],
    href: "/policies",
  },
  {
    id: "separation-of-duties",
    title: "Separation of duties",
    category: "Access",
    updated: "2026-10-16",
    summary: "Administration › Policies & Controls › Separation of Duties Rules lists the rules in force; Risk & Detection › SoD Violations lists every time one caught someone.",
    body: [
      "Separation of Duties Rules shows each rule: the actions one person must not both perform for the same agent, the policy it belongs to, whether a conflict is refused or allowed and recorded, and whether the policy is in effect. A rule is added or changed on its identity policy (Governance Policies); only a policy in effect enforces it.",
      "SoD Violations lists every conflict a rule caught, newest first: when, who, the action they tried and the one they had already done, the agent, and whether it was refused or allowed and recorded. It comes from the audit trail, so it needs permission to read the audit trail.",
    ],
    keywords: ["sod", "separation of duties", "segregation of duties", "conflict", "conflicts", "toxic combination", "maker checker", "four eyes", "refused", "advisory"],
    href: "/sod",
  },
  {
    id: "control-center",
    title: "Controls Dashboard",
    category: "Access",
    updated: "2026-10-16",
    summary: "Administration › Policies & Controls › Controls Dashboard shows the controls governing access in your organization, and what they caught.",
    body: [
      "It counts the policies in effect, the SoD rules in effect, the SoD conflicts in the period your organization sets (30 days unless changed in Governance Settings), the request policies and the active authorization policies. Each card opens its list; a card you can't open isn't shown.",
      "Below, the policies in effect are counted by what they govern, and the policies not in effect (drafts and disabled ones, which enforce nothing) are listed so they can be published or retired. Every number is counted from your organization's own records.",
    ],
    keywords: ["control center", "controls", "overview", "posture", "policies in effect", "draft policies", "governance summary"],
    href: "/controls",
  },
  // -------------------------------------------------------------------- Runtime
  {
    id: "runtime",
    title: "Runtime activity — Observed (DID)",
    category: "Runtime",
    updated: "2026-10-16",
    summary:
      "Runtime shows what each agent actually did — the tools, resources and actions observed — and compares it against SHOULD and CAN.",
    body: [
      "Runtime events arrive from MCP observation, the Runtime Gateway and other configured sources, and build a timeline per agent of tools invoked, resources touched and actions taken. AI Agents › Agent Activity shows the gateway's recent authorization decisions, the emergency controls and the most recent activity; an agent's Runtime (DID) tab shows its own.",
      "In activity lists, a gateway decision is labelled as a decision (Allow, Allow restricted, Needs approval or Deny, with “(observed)” when it was only recorded), not as an action that succeeded or failed.",
      "The comparison on an agent's Runtime (DID) tab puts Approved (SHOULD), Effective Access (CAN), Observed (DID) and Current Request (NOW) side by side, usually the fastest way to explain a finding.",
      "Events are de-duplicated, and anything that can't be processed is quarantined for review rather than dropped.",
    ],
    keywords: ["runtime", "activity", "events", "did", "timeline", "mcp", "observed", "behaviour", "behavior", "quarantine", "decisions"],
    href: "/runtime",
  },
  {
    id: "runtime-gateway",
    title: "The Runtime Gateway",
    category: "Runtime",
    updated: "2026-10-16",
    summary:
      "Agents can ask the Runtime Gateway before acting; it decides from the agent's contract, effective access and policies. It runs in observe-only mode by default: the decision is recorded but the agent is told to go ahead.",
    body: [
      "An agent calls the gateway with its API key and the action it intends. The decision (Allow, Allow with restrictions, Require approval or Deny, with the reason) is recorded and appears under Authorization decisions on Agent Activity and in the agent's activity. The decision comes from rules, never from a model.",
      "In observe-only mode the gateway records what it would have decided without blocking, except for emergency controls, which always block, and the page marks those decisions “observed”. Enforcement is not a setting on any customer screen; when it is on for an organization, a Deny or Require-approval decision is returned to the agent and the organization is notified.",
      "Repeating a request id returns the same decision rather than a second one. The organization and agent always come from the API key, never from the request body.",
    ],
    keywords: ["gateway", "runtime gateway", "enforce", "enforcement", "observe mode", "observe only", "observed", "allow", "deny", "require approval", "decision", "authorization decisions"],
    href: "/runtime",
  },
  {
    id: "emergency-controls",
    title: "Emergency controls",
    category: "Runtime",
    updated: "2026-10-16",
    summary:
      "Incident responders can engage a kill switch, suspend a tool or an MCP server, or terminate a session — each with a reason, each audited, each reversible.",
    body: [
      "The Emergency controls card on AI Agents › Agent Activity offers four controls: a kill switch (every request from every agent in the organization is decided Deny until it is released), tool suspension, MCP server suspension and session termination. Engaging one needs a confirmation and a reason; lifting it does too.",
      "The controls block at once, in observe-only mode too: an agent asking the gateway is told no. To cut off one agent's credentials, use Revoke all keys on that agent's API keys panel.",
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
    updated: "2026-10-16",
    summary:
      "Findings are deterministic, evidence-backed risk records — excessive access, unauthorized actions, sensitive-data violations, ownership gaps and behavioural deviation.",
    body: [
      "Risk & Detection › Risk Dashboard lists every open finding, most severe first, and a By agent table with each agent's open finding count and worst severity. Open an agent's Risk & Findings tab for the detail: severity, category, risk score, the explanation, the contributing reasons, a recommendation, and an evidence link to the specific access or event behind it.",
      "Risk scoring is deterministic and rule-driven. A language model never decides a severity or produces a finding. “Run risk evaluation now” on an agent's Risk & Findings tab re-runs the rules.",
      "Work a finding on that tab: assign it, move it through acknowledged, investigating, mitigated or exception, and resolve it as Verified fixed, Accepted risk or False positive. Accepted risk and False positive need a reason, and a false positive can be given a date after which it is re-checked. A finding can't be resolved as verified fixed while its evidence still triggers the rule.",
      "Request remediation (with a confirmation) revokes the access grants the finding's evidence names. It is a person's decision, never automatic, and the result tells you whether anything was actually revoked; some kinds of finding name no revocable grant. After the underlying access changes, re-evaluation resolves the finding if it no longer holds.",
    ],
    keywords: ["risk", "finding", "alert", "severity", "critical", "violation", "excessive access", "score", "remediation", "request remediation", "assign", "false positive", "accepted risk", "resolve", "evaluate", "evidence"],
    href: "/risk",
  },
  {
    id: "rogue-accounts",
    title: "Rogue accounts",
    category: "Risk",
    updated: "2026-10-16",
    summary:
      "Risk & Detection › Rogue Accounts lists access found in a connected system that nothing in WonderID explains: no request, package or birthright rule granted it.",
    body: [
      "Each account with rogue access gets one ticket, such as RA-000012, numbered in order within your organization; everything rogue on that account belongs to it. The account's page shows the ticket and each piece of rogue access.",
      "Remove access (or Disable account) raises an ordinary request under the application's rules, quoting the ticket number. Under Other outcomes, someone with risk-management permission, never the account's owner, can instead accept it as an exception until a date at most 90 days away, or close it as a false positive, each with a reason.",
      "The ticket stays open until all of the account's rogue access is dealt with: removed (confirmed by a later sync) or approved afterwards, with the request attached. The access history keeps the earlier Rogue status either way.",
    ],
    keywords: ["rogue", "rogue access", "rogue account", "unexplained access", "unauthorized access", "ticket", "RA-", "remove access", "exception", "false positive"],
    href: "/risk/rogue-accounts",
  },
  {
    id: "investigations",
    title: "Investigations",
    category: "Risk",
    updated: "2026-10-16",
    summary:
      "An investigation groups related findings into one case with a timeline, notes and an outcome, so a team can work it to a conclusion.",
    body: [
      "Risk & Detection › Investigations lists them (Active, Awaiting remediation and others) with priority and assignee. Open one from the page's Actions menu by choosing the open findings that belong together. Assign it, add notes and change its status; the timeline records who did what.",
      "Remediation is done from each finding's own page; an investigation only groups them. An investigation can't be resolved while any of its findings is still open.",
    ],
    keywords: ["investigation", "investigations", "case", "incident", "triage", "notes", "timeline", "assign investigation"],
    href: "/risk/investigations",
  },
  {
    id: "rogue-agents",
    title: "Rogue agent detection",
    category: "Risk",
    updated: "2026-10-16",
    summary:
      "Rogue detection highlights agents with open behavioural-deviation, identity-anomaly, ownership or lifecycle findings — signs they are operating outside governance rather than merely holding too much access.",
    body: [
      "A single finding rarely means an agent is rogue. Risk & Detection › Rogue Agents lists the flagged agents; open one to see why it is flagged, the runtime comparison behind the behavioural findings, and who is accountable for it. Access-scope findings are on the agent's Risk & Findings tab instead.",
      "Use it to prioritize: it answers “which agent should I look at first”.",
    ],
    keywords: ["rogue", "detection", "anomaly", "deviation", "suspicious", "priority"],
    href: "/risk/rogue",
  },
  // ----------------------------------------------------------------- Compliance
  {
    id: "certification",
    title: "Access reviews (certification campaigns)",
    category: "Compliance",
    updated: "2026-10-17",
    summary:
      "Access reviews ask reviewers to keep or remove access, recording each decision with a justification and evidence for audit.",
    body: [
      "Access Reviews › Create Campaigns launches a round: a name, a scope, an optional criticality filter, a cadence (one time, periodic or event driven) and a reviewer. A scope can cover AI agents' access (by agent, application, entitlement, privileged access or high-risk agent), people's access, WonderID roles, what access packages contain (reviewed by each package's owner) or an application's entitlements (reviewed by each entitlement's or the application's owner). People's access can be reviewed by each person's manager or the application's owner. Also save as a template keeps the settings for next time.",
      "Review Campaigns lists them with how many items are pending and overdue. Open one to see its items, each with the evidence a reviewer needs; the counts at the top show pending, decided, overdue and escalated items.",
      "The Calendar tab puts open campaigns under the month they are due, past due first. The Analytics tab shows how many items were reviewed, the share revoked, what is open and overdue, the average time to a decision, the outcomes, each scope, and the reviewers with the most overdue items. Each item counts once, by its final decision.",
      "Only the item's assigned reviewer can decide it. The decisions are Approve, Revoke, Modify, Delegate and Request information, and each needs a justification. Revoke removes the access through a task or the connection, and counts as done once a sync no longer finds it; Request information can ask a named person, who is told and answers once. Every decision is recorded once, with who made it, when and what the evidence looked like at that moment.",
      "Nobody certifies their own access or role, and a reviewer who owns the agent can't approve its access without an explicit override, which is audited. Items past their due date are escalated, and the owner is notified.",
    ],
    keywords: ["certification", "campaign", "certify", "certify access", "recertify", "attestation", "review", "reviewer", "recertification", "approve", "revoke", "modify", "delegate", "request information", "overdue", "escalate", "audit", "evidence", "compliance", "control", "calendar", "analytics", "completion"],
    href: "/compliance/campaigns",
  },
  // --------------------------------------------------------------- Integrations
  {
    id: "integrations",
    title: "Connecting source systems",
    category: "Integrations",
    updated: "2026-10-16",
    summary:
      "Connections bring identities, access and runtime events in from your existing systems; their credentials are encrypted and shown masked, and a connection is read-only unless explicitly granted write access.",
    body: [
      "Every flow of your organization's data into or out of WonderID goes through a connection. Administration › Integrations › Connector Library lists what WonderID can connect to: HR systems, identity providers, directories, applications, infrastructure such as Kubernetes, secrets stores, databases, SCIM, webhooks, CSV files, MCP runtimes and agent runtimes. Choose one and connect to create a connection; an administrator can also write a connection type or upgrade a connection to a newer version of its type. Connections lists yours, and people come in through Authoritative Sources.",
      "A connection's page shows every setting and credential its type declares. With permission to manage integrations you can change them there; a credential field left empty keeps the saved value. Saved credentials are shown masked and never in full; they are encrypted at rest and never returned by any API or written to logs. Outbound calls are checked so a connection can't be pointed at internal network addresses, and Governance Settings can limit which hosts connections reach.",
      "A connection declares its capabilities explicitly. One configured read-only cannot write or remediate, and that boundary is enforced. A connection that may make changes is limited to a number of changes an hour, and a sync that finds too much gone waits for a person. Connector Gateway shows the traffic every connection sends and receives.",
      "From a connection's page you can test it and run a sync, or set it to sync on a schedule. Sync runs appear under Sync Jobs with their status and errors; a failed sync also notifies you. MCP Servers inventories the servers, tools and resources your agents use and marks each tool as read or write.",
    ],
    keywords: ["integration", "connector", "connection", "connection type", "saviynt", "rest", "mcp", "webhook", "sync", "sync failed", "import", "credentials", "masked", "settings", "connect", "field mapping", "test connection", "gateway"],
    href: "/integrations",
  },
  // ----------------------------------------------------------------- Operations
  {
    id: "reports-audit",
    title: "Reports, audit and search",
    category: "Operations",
    updated: "2026-10-16",
    summary:
      "The audit trail records every security-sensitive action, reports export governance evidence, and search spans your organization's records.",
    body: [
      "Administration › Reports & Audit › Audit Log records actor, target, action, time and outcome for every security-sensitive operation, including refusals such as an action an authorization policy denied, and shows what a configuration change changed, field by field. Filter it by object type, action, actor and date range, and use Export CSV to take the entries out. The log can't be edited (see “Audit integrity and financial compliance”).",
      "Reports has ten reports, each computed live when you open it and exportable as CSV: AI Agent Inventory, Ownership, Access Certification, Rogue Agent, Access Violation, Risk, Audit Evidence, Policy Compliance, Revocation Closure (every access review revoke, and whether the access is confirmed gone) and Leaver Removal SLA (each leaver's removals in the last 90 days against their due date).",
      "Search (header box or Ctrl+K / ⌘K) finds records from one box, scoped to your organization and to what your roles can read. See “Finding your way around”.",
    ],
    keywords: ["audit", "audit trail", "log", "report", "reports", "export", "csv", "evidence", "history", "who did", "filter"],
    href: "/audit",
  },
  {
    id: "notifications",
    title: "Notifications",
    category: "Operations",
    updated: "2026-10-16",
    summary:
      "Notifications alert the right people to critical findings, approvals waiting on them, overdue reviews, tasks and failed syncs, in-app and by email when email is configured.",
    body: [
      "The bell in the header lists your in-app notifications. Administration › Organization Settings › Notifications lists the notification types that are always sent: certification due and overdue, critical finding, rogue agent, missing owner, integration failure, lifecycle expiry, runtime alert, approval required, billing alert and privacy deadline. They can't be turned off.",
      "You are also told about your own work: lifecycle and provisioning tasks assigned to you, and access about to end.",
      "In-app notifications always work; email delivery also needs the deployment's email provider. Without it you still get the in-app copy.",
    ],
    keywords: ["notification", "notifications", "bell", "email", "alert", "mandatory", "subscribe", "announcement"],
    href: "/settings/notifications",
  },
  // ------------------------------------------------------------- Administration
  {
    id: "users",
    title: "Users and membership",
    category: "Administration",
    updated: "2026-10-16",
    summary:
      "Administration › Users & Roles › Users lists the people in your organization; add them by invitation, and suspend, reactivate, deactivate or remove them with a recorded reason.",
    body: [
      "Add user has three steps: Basic details (name, email, job title and department), ID roles (internal or external user, how they sign in, and the roles they start with) and Review. Choose Send invitation, and they join when they accept it, or Add user, and they are an active member straight away. Inviting needs the invite permission and adding needs the create permission. Add user can also start from a person already under Identities; their page has Give WonderID access when they can't sign in yet. Import CSV… on the Users page invites many people at once, with a preview first.",
      "An invitation expires after the period set in Governance Settings (30 days unless changed). If email isn't configured you're told so, and they can use “Forgot password?” on the sign-in page.",
      "Suspending someone ends their sessions at once; reactivating restores access. Removing them also clears their roles and group memberships, while their history stays in the audit trail. A user's page shows their roles and groups, their effective permissions with where each comes from, their access history and their live sessions.",
      "Nobody can change their own membership or give themselves a role, and the organization always keeps at least one Tenant Administrator.",
    ],
    keywords: ["user", "users", "invite", "invitation", "add user", "suspend", "deactivate", "remove user", "member", "membership", "sessions", "team"],
    href: "/settings/users",
  },
  {
    id: "groups",
    title: "Groups",
    category: "Administration",
    updated: "2026-10-16",
    summary:
      "A group gives its roles to every member, so a team's access is managed once instead of person by person.",
    body: [
      "Administration › Identities › Groups creates a group; give it roles and add its people. Members get the group's roles on their next request, and lose them when they leave the group.",
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
    updated: "2026-10-16",
    summary:
      "Access inside WonderID is role-based: system ID roles cover common jobs, custom roles are built from the permission catalog, and every check happens on the server.",
    body: [
      "Administration › Users & Roles › ID Roles lists the system roles (Tenant Administrator, Security Administrator, Identity Administrator, Agent Administrator, Auditor, Read Only and more) and your custom roles. System roles are read-only; copy one to start a custom role.",
      "The role designer lets you pick permissions by product area. You can only include permissions you hold yourself, so nobody can create a role more powerful than they are. Custom roles can be deactivated; one in use can't be deleted.",
      "Users & Roles › Permissions lists every permission with its resource, action, sensitivity and the roles that grant it.",
      "The interface hides what you can't do, but enforcement happens on the server for every page and action. Platform administration is a separate, vendor-only boundary no customer role can reach.",
    ],
    keywords: ["role", "roles", "permission", "rbac", "admin", "custom role", "system role", "catalog", "read only", "who can"],
    href: "/settings/roles",
  },
  {
    id: "scoped-assignments",
    title: "Scoped and time-limited role assignments",
    category: "Administration",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "Authorization policies override roles: deny an action, or hold it for approval, across the organization or in a scope, with exempt roles for break-glass access.",
    body: [
      "Administration › Users & Roles › Authorization Policies lists them. Pick the permissions a policy covers (or a prefix such as runtime.*), where it applies, and any exempt roles.",
      "A deny wins over every role, including administrators. A require-approval policy currently refuses the direct action and says approval is needed.",
      "Refused actions are recorded in the audit trail. A policy can never cover tenant.security.manage, the permission that manages policies, so a mistaken policy can always be undone.",
    ],
    keywords: ["authorization policy", "deny", "require approval", "break glass", "exempt", "override", "restriction", "block action"],
    href: "/settings/authorization-policies",
  },
  {
    id: "api-clients",
    title: "API clients",
    category: "Administration",
    updated: "2026-10-16",
    summary:
      "An API client lets a pipeline or a service call the WonderID API with its own roles; another administrator approves each one before it works.",
    body: [
      "Administration › Users & Roles › API Clients creates one for an application identity, with its roles and an expiry of at most a year. Its secret is shown once. It works only after a second administrator approves it, and a role added later pauses it until approved again.",
      "It can do only what its roles allow, and never approves access, certifies, approves an onboarding or manages API clients: those are people's decisions. Its calls are audited, and refused ones too.",
    ],
    keywords: ["api client", "automation credential", "service account", "pipeline", "api", "token", "integration user", "machine access"],
    href: "/settings/automation",
  },
  // ------------------------------------------------------------------- Settings
  {
    id: "global-configuration",
    title: "Governance Settings",
    category: "Administration",
    updated: "2026-10-17",
    summary:
      "Administration › Organization Settings › Governance Settings holds the settings that change how WonderID behaves for your whole organization; every save is a version you can restore.",
    body: [
      "Sessions and sign-in: sign out after inactivity (5 to 30 minutes), the longest session (1 to 12 hours), and whether multi-factor authentication is required. Your organization can make sessions shorter than WonderID's own limits of 30 minutes and 12 hours, never longer, and if you belong to several organizations the strictest applies to you. With MFA required, every member verifies with an authenticator app before seeing anything; API clients are exempt.",
      "Access: when an account counts as dormant (30, 60, 90, 180 or 365 days), how long an invitation stays usable, how long approved access has to be set up, and how long before time-bound access ends its holder is reminded. AI agents and runtime: how similar a new agent must be to wait in Duplicate Review, how far back unregistered agent activity is shown, and how often at most a runtime alert is raised for one agent. Risk: when an agent's gateway key is overdue for rotation and how many active keys it may have. Reviews: the risk score from which an agent counts as high-risk. Separation of duties: the period the Controls Dashboard's conflict count covers.",
      "Connections: the share of a kind gone from a source above which a full sync waits for a person, the most changes a connection may make in an hour, and the only hosts connections may reach.",
      "Each setting shows its default, which is how WonderID behaved before the setting existed. A value outside a setting's range is refused, and one invalid value means nothing is saved. Change history lists every saved version, who saved it and what changed; Restore puts an earlier version back as a new version. If two people save at once, the second is told to reload rather than overwriting the first.",
      "Export and import moves these settings between your environments, for example from Dev to production. Export these settings downloads a signed file. In the other environment, choose the file and Preview: it lists each setting the import would change, from and to. Import applies them as a new version, which you can restore like any other. A file edited after export, or from another WonderID, is refused, and each setting still needs its own permission.",
    ],
    keywords: ["global configuration", "configuration", "settings", "organization settings", "session timeout", "idle timeout", "session length", "inactivity", "dormant", "duplicate", "threshold", "key rotation", "high risk", "version", "restore", "rollback", "history", "export", "import", "bundle", "promote", "environment"],
    href: "/settings/configuration",
  },
  {
    id: "sso-security",
    title: "Sign-in, SSO and security settings",
    category: "Settings",
    updated: "2026-10-16",
    summary:
      "Sign in with your email and password, with single sign-on, or with Google, Microsoft or LinkedIn where WonderID has switched that provider on; add an authenticator app for MFA. Sessions expire, and signing out ends your sessions everywhere.",
    body: [
      "The sign-in and sign-up pages offer email and password, “Sign in with SSO”, and Google, Microsoft and LinkedIn buttons. A Google, Microsoft or LinkedIn button works only once that provider has been enabled for WonderID. If it hasn't, the page says so (“Google sign-in is not enabled for WonderID yet”) and you can use your email and password or ask your administrator; if a sign-in is cancelled or doesn't finish, you are returned to the sign-in page with a message. On an organization's own address only email and password and SSO are offered.",
      "For SSO, type your work email first, then choose Sign in with SSO. It works for email domains that have an active connection and otherwise says “No SSO connection configured” for the domain. Only an SSO sign-in joins you to your organization automatically; Google, Microsoft and LinkedIn sign in your own account, and an administrator invites you to an organization.",
      "Forgot your password? Use “Forgot password?” on the sign-in screen; the emailed link lets you set a new one. Repeated reset requests are rate-limited.",
      "My Workspace › Sign-in Security lets you set up an authenticator app (TOTP) for multi-factor authentication, and remove it again. Your organization can require it for everyone in Governance Settings, and an administrator can require an MFA session for one role assignment (see “Scoped and time-limited role assignments”).",
      "Sessions end after inactivity (30 minutes) and after an absolute lifetime (12 hours), or sooner if your organization set shorter limits; you are told “Your session expired” and asked to sign in again. Signing out ends your other sessions too. Administration › Users & Roles › Single Sign-On is where administrators add a SAML or OIDC connection for an email domain; a new connection does not grant access by itself.",
    ],
    keywords: ["sso", "single sign-on", "saml", "oidc", "google", "microsoft", "azure", "linkedin", "social sign in", "not enabled", "sign in", "sign up", "login", "password", "forgot", "reset", "session", "expired", "timeout", "logout", "mfa", "authenticator", "totp"],
    href: "/settings/sso",
  },
  {
    id: "tenant-address",
    title: "Your organization's sign-in address",
    category: "Settings",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "AI summaries and suggestions are advisory only; a tenant can bring its own OpenAI or Gemini key, otherwise the deployment's platform default key is used.",
    body: [
      "AI in WonderID writes summaries and drafts proposals from data that has already been computed. It never makes an authorization, risk, policy or remediation decision.",
      "Administration › Organization Settings › AI Assistance selects the provider and, optionally, your own API key, stored encrypted and shown masked. Without one, the platform default is used when the deployment has one. If neither exists, AI features say so rather than failing silently.",
      "WonderID AI in the account menu, and the “Ask the guide” box on this page, answer only from this guide and link the sections they used. Without an AI provider for your organization, they show the matching guide text itself and say it is not AI-generated.",
    ],
    keywords: ["ai", "openai", "gemini", "api key", "byok", "summary", "chatbot", "assistant", "ask the guide", "model"],
    href: "/settings/ai",
  },
  {
    id: "billing",
    title: "Billing: plans, payment and invoices",
    category: "Settings",
    updated: "2026-10-16",
    summary:
      "Choose or change your plan in Administration › Organization Settings › Billing & Subscription; you pay on Stripe's or Razorpay's secure page and WonderID never sees card or bank details.",
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
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "Every member can download their data, give or withdraw consent, and raise a privacy request from My Workspace › My Privacy (also in the account menu).",
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
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "Every record belongs to one organization and is isolated where it is stored; an organization can also have separate Dev, Test and Staging environments with their own data.",
    body: [
      "You can belong to more than one organization and switch between them, and between an organization's environments, from the switcher at the foot of the sidebar; what you see is always scoped to the active one. Each environment has its own colour, the same in every organization.",
      "Its last item, Manage organizations, lists the organizations you own: rename one, add an environment (Dev, Test or Staging, each a separate organization with its own data, paid for at a plan's price), or start a new organization. Administration › Organization Settings › Organization Profile holds the organization's own details.",
      "Isolation is enforced where the data is stored, not only by the screens in front of it, so a bug in a page cannot leak another organization's records. This applies everywhere, including caches, search, exports and anything sent to an AI provider.",
    ],
    keywords: ["tenant", "organization", "isolation", "multi-tenant", "switch", "workspace", "rls", "data separation"],
    href: "/settings",
  },
  // ------------------------------------------------------------------------ FAQ
  {
    id: "faq-no-findings",
    title: "Why do I have no findings?",
    category: "FAQ",
    updated: "2026-10-16",
    summary:
      "Findings need both sides of a comparison: registered agents with contracts, and imported access or runtime data to compare them against.",
    body: [
      "The usual cause is agents without contracts. With no approved purpose recorded there is no SHOULD, so excessive-access and unauthorized-action checks have nothing to compare against.",
      "The other common cause is no imported data yet: check Administration › Integrations › Sync Jobs to confirm a sync actually completed. Open an agent's Risk & Findings tab and choose “Run risk evaluation now” to re-run the rules for it.",
    ],
    keywords: ["no findings", "empty", "nothing", "missing data", "why", "blank", "not working"],
    href: "/risk",
  },
  {
    id: "faq-cant-see",
    title: "Why can't I see a page or button?",
    category: "FAQ",
    updated: "2026-10-16",
    summary:
      "Your roles don't include the permission it needs, a scoped role doesn't apply there, a role has expired or needs MFA, or an authorization policy denies it.",
    body: [
      "Ask an administrator to open your user page under Administration › Users & Roles › Users: it shows your roles, their scope and dates, and each effective permission with where it comes from.",
      "A refusal that names a policy, “MFA required” or “approval required” tells you exactly which rule stopped you. Ask an administrator to change your role or the policy; nobody can grant themselves access.",
    ],
    keywords: ["can't see", "cannot see", "missing button", "forbidden", "403", "not allowed", "denied", "no access", "permission denied", "mfa required"],
    href: "/settings/users",
  },
  {
    id: "faq-remediation",
    title: "Can WonderID revoke access automatically?",
    category: "FAQ",
    updated: "2026-10-16",
    summary:
      "No — consequential changes require a human to initiate them, and a read-only connector cannot write at all.",
    body: [
      "WonderID recommends remediation, but a person initiates consequential grants, revocations, policy overrides and destructive actions, for example Request remediation on a finding, Revoke on a grant, a Revoke decision in an access review or Remove access on a rogue account, each after a confirmation.",
      "Two things follow from a person's decision or an administrator's setup: a connection that may make changes sets up or removes approved access, and a leaver's access becomes removal work. A request policy can also approve low-risk requests automatically, below a threshold an administrator chooses; high-risk access always needs a person.",
      "This is deliberate. An autonomous system that silently revokes production access is a bigger risk than the one it is trying to manage.",
    ],
    keywords: ["remediation", "revoke", "automatic", "automation", "fix", "remove access"],
    href: "/risk",
  },
  {
    id: "faq-ai-decisions",
    title: "Does AI decide my risk scores?",
    category: "FAQ",
    updated: "2026-10-16",
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
    updated: "2026-10-16",
    summary:
      "Start with the message on the screen; most failures name the rule or the step that stopped you. Your organization's administrator can fix access, and the WonderID team can be emailed from this page.",
    body: [
      "Can't sign in: a Google, Microsoft or LinkedIn button that says the provider “is not enabled” means it hasn't been switched on, so use your email and password. “Your session expired” means sign in again. A message that your organization is suspended means sign-in is paused; contact your administrator. “Forgot password?” sends a link to set a new one.",
      "A page or button is missing, or an action is refused: see “Why can't I see a page or button?”. The refusal names the rule: a policy, “MFA required” or “approval required”.",
      "An import or sync didn't work: for a connection, open Administration › Integrations › Sync Jobs and the connection's page; for an identity source, open the run. It lists the records that couldn't be used and why, and a preview run changes nothing. A failed sync also sends a notification.",
      "An access request is stuck: open it from My Workspace › My Requests. Its approval chain shows who is deciding now and which steps timed out or were invalidated by a change; you can cancel your own request while it waits and submit it again. Approved but not there yet? Its provisioning task shows who is setting it up.",
      "Request remediation changed nothing: the result says whether any grant was revoked. Some findings name no access WonderID can revoke; remove the access in the system that grants it, then run the risk evaluation again.",
      "Still stuck: ask your organization's administrator first; they can see your roles and live sessions on your user page. To reach the WonderID team, use the email link at the bottom of this page.",
    ],
    keywords: ["help", "support", "contact", "error", "not working", "broken", "problem", "troubleshoot", "stuck", "failed", "cannot sign in", "can't log in", "sync failed", "import failed", "who do I ask"],
  },
  {
    id: "faq-assistant",
    title: "How does WonderID AI (“Ask the guide”) work?",
    category: "FAQ",
    updated: "2026-10-16",
    summary:
      "It looks up the guide sections that match your question and answers from them, with links to those sections; it never invents a page or a feature.",
    body: [
      "It looks up the guide sections that match your question by plain keyword matching, not by a model, and the links under an answer are exactly those sections.",
      "If your organization has an AI provider configured, a model may phrase the answer from those sections only. Otherwise you get the section's own summary, marked “not AI-generated”.",
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

/** The latest additions, each pointing at the guide section that explains it. */
export const WHATS_NEW = [
  { id: "identities", label: "Merging duplicate people", note: "Compare two records of the same person, choose the values that stay, merge them, and undo it if needed." },
  { id: "rogue-accounts", label: "Rogue accounts", note: "Access nothing in WonderID explains gets one ticket per account, and is removed through a request." },
  { id: "fulfilment", label: "Provisioning tasks", note: "Approved access a connection can't set up goes to a person or group, and closes when a sync finds it." },
  { id: "certification", label: "Access reviews for everyone", note: "Review people's access, WonderID roles, packages and applications, by managers or owners." },
  { id: "delegations", label: "Delegations and My Team", note: "Hand your approvals to a colleague while away; managers see their direct reports." },
  { id: "identity-rules", label: "Identity rules that grant access", note: "Add people to a group or assign a package, after approval or automatically, from a rule a second person published." },
  { id: "api-clients", label: "API clients", note: "Let a pipeline call the WonderID API with its own roles, approved by a second administrator." },
] as const;
