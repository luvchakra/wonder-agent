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
  | "Agents"
  | "Integrations"
  | "Access"
  | "Runtime"
  | "Risk"
  | "Compliance"
  | "Operations"
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
  {
    id: "what-is-wonderid",
    title: "What WonderID is",
    category: "Getting started",
    summary:
      "WonderID is an identity governance platform. It governs who and what holds access — people, machines and AI agents — and why. Today its most complete part is AI agent governance: ownership, purpose, effective access, runtime behaviour and risk.",
    body: [
      "WonderID treats anything that can receive, use, delegate or lose access as an identity: employees, contractors, external users, service accounts, workloads, APIs and AI agents. For each one it aims to answer who it is, what access it has, why it has it, who approved it, and whether it is still appropriate.",
      "WonderID grew out of WonderID, and its AI agent governance is complete today: every agent gets an owner, an approved purpose, a known set of permissions and an observable record of what it actually did. Governance for people and other machine identities is being added area by area; the navigation shows only what is available now.",
      "WonderID is not an identity provider, a secrets vault or a SIEM. Your IdP still signs people in, and your HR and directory systems remain the source of truth for what they own. WonderID reads from them, keeps a vendor-neutral picture, and shows where approved access, actual capability and real behaviour disagree.",
    ],
    keywords: ["overview", "introduction", "what is", "purpose", "product", "about"],
  },
  {
    id: "first-steps",
    title: "Your first 15 minutes",
    category: "Getting started",
    summary:
      "Create an organization, connect a source system, let it import agents, define each agent's approved purpose, then review the risk findings that result.",
    body: [
      "1. Create or select an organization when you first sign in. Everything in WonderID is scoped to that organization (tenant) — data is never shared between them.",
      "2. Connect a source system under Integrations so WonderID can import the agents and permissions your IAM already knows about.",
      "3. Review imported agents under Agents → Discovery and register the ones that matter.",
      "4. Give each registered agent an owner and an agent contract — its approved purpose, applications, data and actions. This is what Approved (SHOULD) means for that agent.",
      "5. Open Risks & Alerts. Findings appear where an agent can do, or did, something its contract does not approve.",
    ],
    keywords: ["setup", "start", "onboarding", "quick start", "begin", "first", "walkthrough"],
    href: "/",
  },
  {
    id: "should-can-did",
    title: "Approved (SHOULD) vs Effective Access (CAN) vs Observed (DID)",
    category: "Core model",
    summary:
      "Approved (SHOULD) is what an agent is approved to do, Effective Access (CAN) is what its access technically permits, and Observed (DID) is what it actually did — findings come from the gaps between them.",
    body: [
      "Approved (SHOULD) comes from the agent's contract: the purpose, applications, data classes and actions you approved.",
      "Effective Access (CAN) is computed from IAM data — the entitlements, roles, groups, OAuth scopes and tool permissions that agent's identities actually hold. An agent frequently CAN do far more than it SHOULD.",
      "Observed (DID) comes from observed runtime activity: the tools, resources and actions the agent really used.",
      "The product's whole value is the comparison. Access it CAN use but SHOULD not have is excessive access. Something it DID that it SHOULD not have done is a violation. The Runtime and Risk sections show these side by side.",
    ],
    keywords: ["should", "can", "did", "model", "comparison", "concept", "gap", "excessive"],
    href: "/runtime",
  },
  {
    id: "agent-contract",
    title: "Agent contracts (defining Approved (SHOULD))",
    category: "Agents",
    summary:
      "An agent contract records the approved purpose, applications, data and actions for one agent — it is the baseline every risk check compares against.",
    body: [
      "Open an agent and edit its contract to declare what it is approved to do: business purpose, which applications it may touch, which data classes, and which actions (for example READ and REPORT but not WRITE or DELETE).",
      "Contracts also carry autonomy and oversight fields — autonomy level, allowed tools, whether human approval is required, and what monitoring is expected.",
      "Without a contract an agent has no SHOULD, so excessive-access and unauthorized-action findings cannot be calculated for it. Registering an agent and leaving it without a contract is the single most common reason a tenant sees no findings.",
    ],
    keywords: ["contract", "purpose", "approved", "should", "baseline", "policy", "scope", "autonomy"],
    href: "/agents",
  },
  {
    id: "register-agents",
    title: "Registering and owning agents",
    category: "Agents",
    summary:
      "Register an agent to bring it under governance, then assign an accountable owner — unowned agents are themselves a finding.",
    body: [
      "Agents → Register adds an agent manually. Most agents instead arrive through an integration and are registered from the Discovery inbox.",
      "Every agent needs an owner: a named human accountable for it. Ownership drives certification campaigns and remediation routing, and missing ownership is flagged as a governance risk in its own right.",
      "Agents move through lifecycle states (for example proposed, active, restricted, suspended, retired). Transitions are recorded and auditable, and a suspended agent can be restored.",
    ],
    keywords: ["register", "create agent", "owner", "ownership", "lifecycle", "retire", "suspend", "new agent"],
    href: "/agents/new",
  },
  {
    id: "discovery",
    title: "Agent discovery",
    category: "Agents",
    summary:
      "Discovery surfaces agent-like identities found in connected systems so you can register, link or ignore each one.",
    body: [
      "After an integration syncs, WonderID looks for identities that behave like AI agents — service accounts, tokens and non-human identities with agent characteristics — and lists them in the Discovery inbox with the evidence behind each candidate and a confidence signal.",
      "From there you can register a candidate as a governed agent, link it to an agent you already registered, or ignore it. Ignoring is recorded, not silent, so the same candidate does not reappear as noise.",
      "Duplicate detection runs alongside this and proposes merges when the same real agent appears under several identities.",
    ],
    keywords: ["discovery", "inbox", "candidates", "unregistered", "shadow", "duplicates", "merge"],
    href: "/agents/discovery",
  },
  {
    id: "integrations",
    title: "Connecting source systems",
    category: "Integrations",
    summary:
      "Integrations import identities, permissions and runtime events from your existing systems; credentials are encrypted and connectors are read-only unless explicitly granted write access.",
    body: [
      "Integrations → New connects a source. WonderID ships a Saviynt read integration, a generic REST connector, and MCP runtime ingestion, plus webhook endpoints for push-style sources.",
      "Credentials are encrypted at rest and are never returned by any API, logged, or shown back to you after saving.",
      "A connector declares its capabilities explicitly. One configured read-only cannot perform writes or remediation — that boundary is enforced, not merely documented.",
      "Sync runs appear under Integrations → Jobs with their status and any errors, so a failed import is visible rather than silent.",
    ],
    keywords: ["integration", "connector", "saviynt", "rest", "mcp", "webhook", "sync", "import", "credentials", "api key"],
    href: "/integrations",
  },
  {
    id: "effective-access",
    title: "Effective Access (CAN)",
    category: "Access",
    summary:
      "The effective access view computes what an agent can technically do today, including access inherited through roles and groups, and shows the path that grants it.",
    body: [
      "Access shows each agent's computed capability: entitlements, application roles, groups, OAuth scopes and tool permissions, resolved across every identity that agent owns.",
      "Access paths matter as much as the totals. WonderID shows how a permission was granted — directly, through a role, through nested group membership, or through delegation — so you can remove the right grant rather than guessing.",
      "This is the CAN half of the model, and it is computed from imported IAM data rather than asserted by hand.",
    ],
    keywords: ["access", "effective", "entitlement", "permission", "can", "role", "group", "scope", "path", "graph"],
    href: "/access",
  },
  {
    id: "policies",
    title: "Policies",
    category: "Access",
    summary:
      "Policies express organization-wide rules that agents are evaluated against, independently of any single agent's contract.",
    body: [
      "Where a contract is per-agent, a policy applies across agents — for example forbidding any agent from holding write access to a production financial system, or requiring human approval for a class of action.",
      "Policy evaluation is deterministic. No policy decision in WonderID depends on a language model.",
      "Violations surface as findings in Risks & Alerts alongside contract-based findings.",
    ],
    keywords: ["policy", "policies", "rule", "violation", "guardrail", "evaluation"],
    href: "/policies",
  },
  {
    id: "runtime",
    title: "Runtime activity — Observed (DID)",
    category: "Runtime",
    summary:
      "Runtime shows what each agent actually did — the tools, resources and actions observed — and compares it against SHOULD and CAN.",
    body: [
      "Runtime events arrive from MCP runtime observation and other configured sources, and build a timeline per agent of tools invoked, resources touched and actions taken.",
      "The comparison view puts Approved (SHOULD), Effective Access (CAN) and Observed (DID) next to each other for one agent, which is usually the fastest way to explain a finding to someone who did not configure the agent.",
      "Activity WonderID cannot attribute to a governed agent is itself signal, and feeds discovery rather than being discarded.",
    ],
    keywords: ["runtime", "activity", "events", "did", "timeline", "mcp", "observed", "behaviour", "behavior"],
    href: "/runtime",
  },
  {
    id: "findings",
    title: "Risk findings",
    category: "Risk",
    summary:
      "Findings are deterministic, evidence-backed risk records — excessive access, unauthorized actions, sensitive-data violations, ownership gaps and behavioural deviation.",
    body: [
      "Risks & Alerts lists open findings with a severity, the agent involved, and the evidence that produced them. Every finding can be traced back to the specific access or event behind it.",
      "Risk scoring is deterministic and rule-driven. A language model never decides a severity or produces a finding — that is an architectural rule, not a configuration choice.",
      "Findings carry a recommended remediation, but consequential changes (revoking access, suspending an agent) require a human to initiate them.",
      "Re-evaluation closes the loop: once the underlying access or behaviour changes, the finding is re-checked and resolved if it no longer holds.",
    ],
    keywords: ["risk", "finding", "alert", "severity", "critical", "violation", "excessive access", "score", "remediation"],
    href: "/risk",
  },
  {
    id: "rogue-agents",
    title: "Rogue agent detection",
    category: "Risk",
    summary:
      "Rogue detection highlights agents whose combined signals — unapproved access, unexpected behaviour, missing ownership — indicate they are operating outside governance.",
    body: [
      "A single finding rarely means an agent is rogue. The rogue view aggregates the signals for one agent so a pattern is visible: acting outside its contract, holding access nobody approved, or having no accountable owner.",
      "Use it to prioritize. It answers 'which agent should I look at first' rather than 'what is technically wrong here'.",
    ],
    keywords: ["rogue", "detection", "anomaly", "deviation", "suspicious", "priority"],
    href: "/risk/rogue",
  },
  {
    id: "certification",
    title: "Certification campaigns",
    category: "Compliance",
    summary:
      "Campaigns ask reviewers to certify each agent's access on a schedule, recording keep/revoke decisions with evidence for audit.",
    body: [
      "Compliance → Campaigns launches a certification round. Each item pairs an agent's access with the risk and usage evidence a reviewer needs, so decisions are informed rather than rubber-stamped.",
      "Reviewers keep, flag or revoke. Every decision is recorded with who made it, when, and on what evidence.",
      "Overdue items escalate automatically, and the campaign produces an evidence pack suitable for handing to an auditor.",
    ],
    keywords: ["certification", "campaign", "attestation", "review", "recertification", "audit", "evidence", "compliance", "control"],
    href: "/compliance/campaigns",
  },
  {
    id: "reports-audit",
    title: "Reports, audit and search",
    category: "Operations",
    summary:
      "The audit log records every security-sensitive action, reports export governance evidence, and search spans agents, findings and policies.",
    body: [
      "Audit records actor, tenant, target, action, timestamp and outcome for every security-sensitive operation, and is designed to be read as evidence rather than as debug logging.",
      "Reports produce exportable governance evidence, including a governance evidence pack as PDF and CSV exports of underlying data.",
      "Search covers agents, findings and policies from one box, scoped to your organization.",
    ],
    keywords: ["audit", "log", "report", "export", "csv", "pdf", "evidence", "search", "history", "who did"],
    href: "/audit",
  },
  {
    id: "notifications",
    title: "Notifications",
    category: "Operations",
    summary:
      "Notifications alert the right people to new critical findings, overdue certifications and failed syncs, in-app and by email when email is configured.",
    body: [
      "Settings → Notifications controls which events reach you. In-app notification always works; email delivery additionally requires the deployment to have an email provider configured.",
      "If email is not configured, notifications still appear in-app rather than failing — you simply do not get the mail copy.",
    ],
    keywords: ["notification", "email", "alert", "digest", "subscribe", "resend"],
    href: "/settings/notifications",
  },
  {
    id: "roles-permissions",
    title: "Roles and permissions",
    category: "Settings",
    summary:
      "Access inside WonderID is role-based; roles grant granular permissions and are managed per organization under Settings → Roles.",
    body: [
      "Built-in roles range from a full tenant super administrator down to read-only and requester roles that can see agents but not policies.",
      "Permissions are checked server-side on every route and action — the UI hides what you cannot do, but the enforcement is not the hiding.",
      "Platform administration is a separate boundary entirely. It belongs to the vendor operating WonderID and is never reachable by a customer role, no matter how privileged.",
    ],
    keywords: ["role", "permission", "rbac", "admin", "read only", "requester", "access control", "who can"],
    href: "/settings/roles",
  },
  {
    id: "sso-security",
    title: "SSO, sessions and security settings",
    category: "Settings",
    summary:
      "Sign in with a password, Google, or SSO; sessions expire on idle and absolute timeouts, and signing out ends your sessions everywhere.",
    body: [
      "Password sign-in, Google sign-in and domain-based SSO are all available from the sign-in screen. SSO routes users whose email domain has an active connection to their identity provider.",
      "Forgot your password? Use the 'Forgot password?' link on the sign-in screen; the emailed link lets you set a new one.",
      "Sessions end after a period of inactivity and after an absolute lifetime regardless of activity. Logging out is global by design — it ends your other sessions too.",
      "Settings → SSO configures connections and just-in-time role mapping; Settings → Security covers the remaining organization-level security options.",
    ],
    keywords: ["sso", "saml", "oidc", "google", "sign in", "login", "password", "forgot", "session", "timeout", "logout", "mfa"],
    href: "/settings/sso",
  },
  {
    id: "ai-provider",
    title: "AI features and provider keys",
    category: "Settings",
    summary:
      "AI summaries are advisory only; a tenant can bring its own OpenAI or Gemini key, otherwise the deployment's platform default key is used.",
    body: [
      "AI in WonderID writes prose summaries of data that has already been computed. It never makes an authorization, risk, policy or remediation decision — those are always deterministic.",
      "Settings → AI selects the provider and, optionally, your own API key. If you do not bring a key, the platform-wide default key is used when the deployment has one configured.",
      "If neither exists, AI features say so and tell you how to fix it rather than failing silently. Setting the platform default is currently a deployment environment-variable change; there is no platform admin screen for it yet.",
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
      "You can belong to more than one organization and switch between them; what you see is always scoped to the active one.",
      "Isolation is enforced by row-level security in the database, not only by application code, so an application bug cannot leak another organization's rows.",
      "This applies everywhere, including caches, search indexes, exports and anything sent to an AI provider.",
    ],
    keywords: ["tenant", "organization", "isolation", "multi-tenant", "switch", "workspace", "rls", "data separation"],
    href: "/settings",
  },
  {
    id: "faq-no-findings",
    title: "Why do I have no findings?",
    category: "FAQ",
    summary:
      "Findings need both sides of a comparison: registered agents with contracts, and imported access or runtime data to compare them against.",
    body: [
      "The usual cause is agents without contracts. With no approved purpose recorded there is no SHOULD, so excessive-access and unauthorized-action checks have nothing to compare against.",
      "The other common cause is no imported data yet — check Integrations → Jobs to confirm a sync actually completed rather than failing.",
    ],
    keywords: ["no findings", "empty", "nothing", "missing data", "why", "blank", "not working"],
    href: "/risk",
  },
  {
    id: "faq-remediation",
    title: "Can WonderID revoke access automatically?",
    category: "FAQ",
    summary:
      "No — consequential changes require a human to initiate them, and a read-only connector cannot write at all.",
    body: [
      "WonderID recommends remediation and can hand it to your IAM workflow, but a human initiates consequential grants, revocations, policy overrides and destructive actions.",
      "This is deliberate. An autonomous system that silently revokes production access is a bigger risk than the one it is trying to manage.",
    ],
    keywords: ["remediation", "revoke", "automatic", "automation", "fix", "remove access", "approval"],
    href: "/risk",
  },
  {
    id: "faq-ai-decisions",
    title: "Does AI decide my risk scores?",
    category: "FAQ",
    summary:
      "No. Risk, policy, authorization and isolation decisions are deterministic; AI only writes summaries of results it is given.",
    body: [
      "Every score and finding comes from explicit rules you can trace. AI output is labelled advisory and is never read back into a decision.",
      "That means turning AI off changes what the product explains, never what it decides.",
    ],
    keywords: ["ai", "llm", "deterministic", "score", "decision", "trust", "hallucination", "accuracy"],
    href: "/risk",
  },
];

export const GUIDE_CATEGORIES: GuideCategory[] = [
  "Getting started",
  "Core model",
  "Agents",
  "Integrations",
  "Access",
  "Runtime",
  "Risk",
  "Compliance",
  "Operations",
  "Settings",
  "FAQ",
];

export function sectionsByCategory(category: GuideCategory): GuideSection[] {
  return GUIDE_SECTIONS.filter((s) => s.category === category);
}

export function getSection(id: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find((s) => s.id === id);
}
