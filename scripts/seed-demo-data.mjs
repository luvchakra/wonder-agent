#!/usr/bin/env node
/**
 * Seeds one organization with a coherent demo dataset that exercises every
 * module: agents with owners, contracts and identities; applications, data
 * sources, entitlements, accounts and grants; MCP servers, tools and
 * resources; runtime activity and Shadow AI; runtime policies; findings
 * with evidence; investigations; a certification campaign; control
 * mappings. It is the FinanceBot story of CLAUDE.md §11 plus four more
 * agents, each chosen to light up a different part of the product.
 *
 *   node scripts/seed-demo-data.mjs --tenant <slug> [--gateway <app url>]
 *
 * - Scoped to the ONE tenant named by slug; every row is written with that
 *   tenant's id and nothing else is read or written (§14).
 * - Idempotent: everything is found by a natural key (name, reference,
 *   dedupe key, request id) before it is created, so a re-run adds nothing
 *   twice and never overwrites what someone changed in the product.
 * - Additive: existing agents and data are reused, never modified, except
 *   linking an existing entitlement to its data source when it has none.
 * - With --gateway, gateway decisions are NOT written directly: the script
 *   mints a key per agent and sends real requests to that app's Runtime
 *   Gateway, so every decision, timeline event and audit row is the real
 *   engine's output. Request ids are fixed, so a re-run replays them.
 * - Uses the service-role key from .env.local (server-side only, never
 *   printed). Run it only against an organization that holds demo data.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------- setup
function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // Fall back to the process environment.
  }
}
loadEnv();

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.tenant) {
  console.error("usage: node scripts/seed-demo-data.mjs --tenant <slug> [--gateway <app url>]");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.local).");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const counts = {};
const bump = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 60 * 60 * 1000).toISOString();
const ahead = (days) => new Date(now + days * DAY).toISOString();

function must(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

/** Finds a row in this tenant by `match`, or inserts `row`. Returns the row. */
async function ensure(table, match, row, label = table) {
  let q = db.from(table).select("*").eq("tenant_id", T);
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const found = must(await q.limit(1).maybeSingle(), `find ${table}`);
  if (found) return found;
  const created = must(await db.from(table).insert({ tenant_id: T, ...match, ...row }).select().single(), `insert ${table}`);
  bump(label);
  return created;
}

// ---------------------------------------------------------------- tenant
const tenant = must(await db.from("tenants").select("id, name, slug").eq("slug", args.tenant).maybeSingle(), "tenant");
if (!tenant) {
  console.error(`No organization with slug "${args.tenant}".`);
  process.exit(1);
}
const T = tenant.id;
console.log(`Seeding ${tenant.name} (${tenant.slug})`);

// Owners and reviewers must be active members (IDENTITY-P0-13). Prefer a
// TENANT_SUPER_ADMIN as the lead; the other member (if any) reviews.
const members = must(
  await db.from("tenant_memberships").select("user_id, users(email)").eq("tenant_id", T).eq("status", "active"),
  "members",
);
if (members.length === 0) throw new Error("The organization has no active members to own the demo agents.");
const admins = must(
  await db.from("user_roles").select("user_id, roles!inner(name)").eq("tenant_id", T).eq("roles.name", "TENANT_SUPER_ADMIN"),
  "admins",
);
const lead = admins[0]?.user_id ?? members[0].user_id;
const second = members.find((m) => m.user_id !== lead)?.user_id ?? lead;

// ---------------------------------------------------------------- applications
const APPS = {
  Snowflake: "data_warehouse",
  SAP: "erp",
  S3: "storage",
  Zendesk: "support",
  Workday: "hr",
  Salesforce: "crm",
  ServiceNow: "itsm",
  GitHub: "devtools",
  Slack: "collaboration",
  Coupa: "procurement",
};
const app = {};
for (const [name, category] of Object.entries(APPS)) app[name] = await ensure("applications", { name }, { category }, "applications");

// ---------------------------------------------------------------- data sources
const SOURCES = [
  ["Snowflake · FINANCE_DW", "warehouse", "financial", "Snowflake", "Finance Data Platform", "Curated general-ledger and reporting marts."],
  ["Snowflake · CUSTOMER_DB", "warehouse", "pii", "Snowflake", "Customer Data Office", "Customer master data: names, emails, addresses."],
  ["SAP S/4HANA · General Ledger", "database", "financial", "SAP", "Group Controlling", "Posting ledger of record."],
  ["S3 · finance-exports", "object_store", "confidential", "S3", "Finance Data Platform", "Nightly report exports."],
  ["Salesforce · Contacts", "saas", "pii", "Salesforce", "Revenue Operations", "Prospect and customer contacts."],
  ["Zendesk · Tickets", "saas", "internal", "Zendesk", "Customer Support", "Support tickets and macros."],
  ["Workday · Employee Records", "saas", "restricted", "Workday", "People Operations", "Employee personal and compensation data."],
  ["GitHub · wonderark/platform", "saas", "internal", "GitHub", "Platform Engineering", "Application source code."],
  ["ServiceNow · CMDB", "saas", "internal", "ServiceNow", "IT Operations", "Configuration items and incidents."],
];
const source = {};
for (const [name, kind, classification, appName, owner, description] of SOURCES) {
  source[name] = await ensure(
    "data_sources",
    { name },
    { kind, classification, application_id: app[appName].id, owner, description, status: "active" },
    "data_sources",
  );
}

// ---------------------------------------------------------------- entitlements
// [name, app, classification, privilege, data source]
const ENTS = [
  ["Financial_Reporting_READ", "Snowflake", "financial", "standard", "Snowflake · FINANCE_DW"],
  ["CustomerDB_READ", "Snowflake", "pii", "standard", "Snowflake · CUSTOMER_DB"],
  ["SAP_READ", "SAP", "financial", "standard", "SAP S/4HANA · General Ledger"],
  ["S3_READ", "S3", "confidential", "standard", "S3 · finance-exports"],
  ["Tickets_READWRITE", "Zendesk", "internal", "standard", "Zendesk · Tickets"],
  ["Salesforce_ADMIN", "Salesforce", "confidential", "admin", "Salesforce · Contacts"],
  ["Incident_WRITE", "ServiceNow", "internal", "elevated", "ServiceNow · CMDB"],
  ["CMDB_READ", "ServiceNow", "internal", "standard", "ServiceNow · CMDB"],
  ["chat_WRITE", "Slack", "internal", "standard", null],
  ["repo_READ", "GitHub", "internal", "standard", "GitHub · wonderark/platform"],
  ["pull_request_WRITE", "GitHub", "internal", "elevated", "GitHub · wonderark/platform"],
  ["PO_CREATE", "Coupa", "financial", "elevated", null],
  ["Supplier_READ", "Coupa", "internal", "standard", null],
  ["AP_Invoice_READ", "SAP", "financial", "standard", "SAP S/4HANA · General Ledger"],
  // MCP tool permissions (INTEGRATION-P0-06): held as entitlements on the tool.
  ["read_logs", "ServiceNow", "internal", "standard", null],
  ["restart_service", "ServiceNow", "internal", "elevated", null],
  ["delete_vm", "ServiceNow", "internal", "admin", null],
];
const ent = {};
for (const [name, appName, cls, privilege, src] of ENTS) {
  const row = await ensure(
    "entitlements",
    { application_id: app[appName].id, name },
    { data_classification: cls, privilege_level: privilege, data_source_id: src ? source[src].id : null },
    "entitlements",
  );
  // An existing entitlement with no data source gets its link (ACCESS-P0-13).
  if (src && !row.data_source_id) {
    must(await db.from("entitlements").update({ data_source_id: source[src].id }).eq("id", row.id).eq("tenant_id", T), "link data source");
    bump("entitlement_data_source_links");
  }
  ent[name] = row;
}

// ---------------------------------------------------------------- integrations
const saviynt = await ensure(
  "integrations",
  { integration_type_id: "saviynt", name: "Saviynt — Production" },
  { status: "connected", config: { baseUrl: "https://wonderark.saviyntcloud.com" }, capabilities: { read: true, write: false }, last_sync_at: ago(0, 3) },
);
const financeMcp = await ensure(
  "integrations",
  { integration_type_id: "mcp", name: "MCP Runtime Gateway" },
  { status: "connected", config: { baseUrl: "https://mcp.finance.wonderark.example/mcp" }, capabilities: { read: true, write: false }, last_sync_at: ago(0, 5) },
);
const itopsMcp = await ensure(
  "integrations",
  { integration_type_id: "mcp", name: "ITOps MCP" },
  { status: "connected", config: { baseUrl: "https://mcp.itops.wonderark.example/mcp" }, capabilities: { read: true, write: false }, last_sync_at: ago(0, 2) },
);

/** A stable UUID from a string, so a re-run finds the same row. */
function stableUuid(text) {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function mcpInventory(integration, server, tools, resources) {
  const job = await ensure(
    "integration_sync_jobs",
    { integration_id: integration.id, correlation_id: stableUuid(`demo-sync:${integration.id}`), trigger: "scheduled", status: "succeeded" },
    { started_at: ago(0, 2), ended_at: ago(0, 2), records_processed: 1 + tools.length + resources.length, records_failed: 0 },
    "sync_jobs",
  );
  const put = (objectType, externalId, normalized) =>
    ensure("integration_objects", { integration_id: integration.id, object_type: objectType, external_id: externalId }, { raw: normalized, normalized, sync_job_id: job.id }, "mcp_objects");
  await put("mcp_server", "server", { endpoint: integration.config?.baseUrl ?? null, ...server });
  for (const [name, description, operation, destructive] of tools) {
    await put("mcp_tool", name, { name, description, operation, operationBasis: "annotation", destructive, inputSchema: { type: "object" } });
  }
  for (const [uri, name, mimeType] of resources) await put("mcp_resource", uri, { uri, name, mimeType });
}
await mcpInventory(
  financeMcp,
  { serverName: "finance-mcp", serverVersion: "1.4.2", protocolVersion: "2025-06-18" },
  [
    ["query_ledger", "Read ledger balances for a period.", "read", false],
    ["get_report", "Fetch a published financial report.", "read", false],
    ["post_journal_entry", "Post a journal entry to the general ledger.", "write", true],
  ],
  [["ledger://fy2026", "FY2026 ledger", "application/json"]],
);
await mcpInventory(
  itopsMcp,
  { serverName: "itops-mcp", serverVersion: "0.9.0", protocolVersion: "2025-06-18" },
  [
    ["read_logs", "Tail application logs for a service.", "read", false],
    ["create_incident", "Open a ServiceNow incident.", "write", false],
    ["restart_service", "Restart a service through its runbook.", "write", false],
    ["delete_vm", "Delete a virtual machine.", "write", true],
  ],
  [["runbook://restart-service", "Restart-service runbook", "text/markdown"]],
);

// ---------------------------------------------------------------- agents
const AGENTS = [
  {
    agent_name: "FinanceBot",
    display_name: "FinanceBot",
    description: "Prepares month-end financial reporting packs.",
    purpose: "Financial reporting",
    agent_type: "reporting",
    agent_framework: "LangChain",
    model_provider: "Anthropic",
    model_name: "claude-sonnet",
    environment: "production",
    criticality: "high",
    data_classification: "financial",
    lifecycle_state: "ACTIVE",
    status: "active",
    source_system: "saviynt",
    risk_score: 82,
    activated_at: ago(90),
  },
  {
    agent_name: "ITOpsRunbookAgent",
    display_name: "ITOps Runbook Agent",
    description: "Triages infrastructure incidents and runs approved runbooks.",
    purpose: "Incident triage and approved runbook execution",
    agent_type: "operations",
    agent_framework: "LangGraph",
    model_provider: "Anthropic",
    model_name: "claude-sonnet",
    runtime: "Kubernetes",
    environment: "production",
    criticality: "critical",
    data_classification: "internal",
    lifecycle_state: "ACTIVE",
    status: "active",
    source_system: "manual",
    risk_score: 78,
    activated_at: ago(40),
    last_seen_at: ago(0, 1),
  },
  {
    agent_name: "ProcurementCopilot",
    display_name: "Procurement Copilot",
    description: "Drafts purchase orders from approved requisitions.",
    purpose: "Purchase-order drafting from approved requisitions",
    agent_type: "copilot",
    agent_framework: "Semantic Kernel",
    model_provider: "Azure OpenAI",
    model_name: "gpt-4o",
    runtime: "Azure Functions",
    environment: "production",
    criticality: "high",
    data_classification: "financial",
    lifecycle_state: "ACTIVE",
    status: "active",
    source_system: "saviynt",
    risk_score: 46,
    activated_at: ago(62),
    last_seen_at: ago(0, 4),
  },
  {
    agent_name: "CodeReviewAgent",
    display_name: "Code Review Agent",
    description: "Reviews pull requests and leaves comments.",
    purpose: "Pull-request review comments",
    agent_type: "developer_tool",
    agent_framework: "custom",
    model_provider: "Anthropic",
    model_name: "claude-sonnet",
    runtime: "GitHub Actions",
    environment: "staging",
    criticality: "medium",
    data_classification: "internal",
    lifecycle_state: "ACTIVE",
    status: "active",
    source_system: "manual",
    risk_score: 58,
    activated_at: ago(21),
    last_seen_at: ago(0, 6),
  },
  {
    agent_name: "InvoiceReconciler",
    display_name: "Invoice Reconciler",
    description: "Matches supplier invoices to purchase orders and receipts.",
    purpose: "Three-way invoice matching",
    agent_type: "workflow",
    agent_framework: "CrewAI",
    model_provider: "Anthropic",
    model_name: "claude-haiku",
    runtime: "Kubernetes",
    environment: "production",
    criticality: "high",
    data_classification: "financial",
    lifecycle_state: "APPROVED",
    status: "approved",
    source_system: "saviynt",
    risk_score: 22,
  },
  {
    agent_name: "SalesForecastAgent",
    display_name: "Sales Forecast Agent",
    description: "Builds weekly pipeline forecasts. Awaiting its contract.",
    purpose: "Weekly pipeline forecasting",
    agent_type: "analytics",
    model_provider: "Google",
    model_name: "gemini-pro",
    runtime: "Vertex AI",
    environment: "development",
    criticality: "low",
    lifecycle_state: "REGISTERED",
    status: "registered",
    source_system: "manual",
    risk_score: 12,
  },
];
const agent = {};
for (const a of AGENTS) {
  const { agent_name, ...rest } = a;
  // An existing agent of the same name is reused untouched.
  agent[agent_name] = await ensure("agents", { agent_name }, { lifecycle_state: "REGISTERED", status: "registered", ...rest }, "agents");
}
for (const name of ["CustomerSupportBot", "RogueDataMinerBot"]) {
  const row = must(await db.from("agents").select("*").eq("tenant_id", T).eq("agent_name", name).maybeSingle(), name);
  if (row) agent[name] = row;
}

// Lifecycle history for the new ones (only when an agent has none).
const PATHS = {
  FinanceBot: [["REGISTERED", 95], ["APPROVED", 92], ["PROVISIONED", 91], ["ACTIVE", 90]],
  ITOpsRunbookAgent: [["REGISTERED", 45], ["ASSESSED", 44], ["APPROVED", 43], ["PROVISIONED", 41], ["ACTIVE", 40]],
  ProcurementCopilot: [["REGISTERED", 70], ["APPROVED", 66], ["PROVISIONED", 63], ["ACTIVE", 62]],
  CodeReviewAgent: [["REGISTERED", 25], ["APPROVED", 23], ["PROVISIONED", 22], ["ACTIVE", 21]],
  InvoiceReconciler: [["REGISTERED", 9], ["ASSESSED", 6], ["APPROVED", 3]],
  SalesForecastAgent: [["REGISTERED", 2]],
};
for (const [name, path] of Object.entries(PATHS)) {
  const existing = must(await db.from("agent_lifecycle_events").select("id").eq("tenant_id", T).eq("agent_id", agent[name].id).limit(1), "lifecycle");
  if (existing.length) continue;
  let from = "DISCOVERED";
  for (const [to, days] of path) {
    must(
      await db.from("agent_lifecycle_events").insert({ tenant_id: T, agent_id: agent[name].id, from_state: from, to_state: to, reason: `${to.toLowerCase()} (demo seed)`, actor_id: lead, actor_type: "user", created_at: ago(days) }),
      "lifecycle insert",
    );
    bump("lifecycle_events");
    from = to;
  }
}

// ---------------------------------------------------------------- owners
const OWNERS = [
  ["FinanceBot", "business_owner", lead],
  ["FinanceBot", "technical_owner", lead],
  ["ITOpsRunbookAgent", "business_owner", lead],
  ["ITOpsRunbookAgent", "technical_owner", second],
  ["ITOpsRunbookAgent", "iam_owner", lead],
  ["ProcurementCopilot", "business_owner", second], // no technical owner: a real ownership gap
  ["CodeReviewAgent", "business_owner", lead],
  ["CodeReviewAgent", "technical_owner", second],
  ["InvoiceReconciler", "business_owner", lead],
  ["InvoiceReconciler", "technical_owner", lead],
  ["SalesForecastAgent", "business_owner", second],
];
for (const [name, owner_type, user_id] of OWNERS) {
  await ensure("agent_owners", { agent_id: agent[name].id, owner_type, user_id, removed_at: null }, { assigned_at: ago(30), last_reviewed_at: name === "ITOpsRunbookAgent" ? ago(12) : null, last_reviewed_by: name === "ITOpsRunbookAgent" ? lead : null }, "owners");
}
// A time-bounded delegation (IDENTITY-P0-13).
if (second !== lead) {
  await ensure(
    "agent_owners",
    { agent_id: agent.InvoiceReconciler.id, owner_type: "delegated_owner", user_id: second, removed_at: null },
    { assigned_at: ago(3), delegated_by: lead, delegation_expires_at: ahead(45) },
    "owners",
  );
}

// ---------------------------------------------------------------- contracts
const CONTRACTS = {
  FinanceBot: {
    purpose: "Prepare financial reporting from approved financial data.",
    owner_summary: "Finance Operations",
    approved_applications: ["SAP", "Snowflake"],
    approved_data: ["financial"],
    prohibited_data: ["pii"],
    approved_actions: ["read", "report"],
    prohibited_actions: ["delete"],
    allowed_tools: ["query_ledger", "get_report"],
    actions_requiring_approval: [],
    autonomy_level: 3,
    certification_frequency: "quarterly",
    maximum_risk: "high",
    approved_users: ["finance-operations"],
    approved_delegators: [],
    allowed_environments: ["production"],
    expires_at: ahead(270),
  },
  ITOpsRunbookAgent: {
    purpose: "Triage infrastructure incidents and run approved runbooks.",
    owner_summary: "IT Operations",
    approved_applications: ["ServiceNow", "Slack"],
    approved_data: ["internal"],
    prohibited_data: ["pii", "restricted"],
    approved_actions: ["read", "create", "restart"],
    prohibited_actions: ["delete"],
    allowed_tools: ["read_logs", "create_incident", "restart_service"],
    actions_requiring_approval: ["restart"],
    autonomy_level: 3,
    certification_frequency: "quarterly",
    maximum_risk: "high",
    required_monitoring: "Every tool call through the Runtime Gateway",
    required_compliance_controls: ["ISO 27001 A.8.2"],
    approved_users: ["it-operations"],
    approved_delegators: [],
    allowed_environments: ["production"],
    expires_at: ahead(160),
  },
  ProcurementCopilot: {
    purpose: "Draft purchase orders from approved requisitions.",
    owner_summary: "Procurement",
    approved_applications: ["Coupa"],
    approved_data: ["financial", "internal"],
    prohibited_data: ["pii"],
    approved_actions: ["read", "create"],
    prohibited_actions: ["approve", "delete"],
    allowed_tools: ["search_suppliers", "create_po"],
    actions_requiring_approval: ["create"],
    autonomy_level: 2,
    certification_frequency: "quarterly",
    maximum_risk: "medium",
    approved_users: ["procurement-team"],
    approved_delegators: [],
    allowed_environments: ["production"],
    expires_at: ahead(200),
  },
  CodeReviewAgent: {
    purpose: "Comment on pull requests; never merge.",
    owner_summary: "Platform Engineering",
    approved_applications: ["GitHub"],
    approved_data: ["internal"],
    prohibited_data: ["pii", "restricted"],
    approved_actions: ["read", "comment"],
    prohibited_actions: ["merge", "delete"],
    allowed_tools: ["read_diff", "comment_on_pr"],
    actions_requiring_approval: [],
    autonomy_level: 3,
    certification_frequency: "semiannual",
    maximum_risk: "high",
    approved_users: ["engineering"],
    approved_delegators: [],
    allowed_environments: ["staging"],
    expires_at: ahead(120),
  },
  InvoiceReconciler: {
    purpose: "Match supplier invoices to purchase orders and goods receipts.",
    owner_summary: "Accounts Payable",
    approved_applications: ["SAP", "Coupa"],
    approved_data: ["financial"],
    prohibited_data: ["pii"],
    approved_actions: ["read", "report"],
    prohibited_actions: ["post", "delete"],
    allowed_tools: ["query_ledger", "get_report"],
    actions_requiring_approval: [],
    autonomy_level: 1,
    certification_frequency: "quarterly",
    maximum_risk: "medium",
    approved_users: ["accounts-payable"],
    approved_delegators: ["FinanceBot"],
    allowed_environments: ["production"],
    expires_at: ahead(365),
  },
};
for (const [name, c] of Object.entries(CONTRACTS)) {
  const existing = must(await db.from("agent_contracts").select("id").eq("tenant_id", T).eq("agent_id", agent[name].id).eq("status", "active").maybeSingle(), "contract");
  if (existing) continue;
  must(await db.from("agent_contracts").insert({ tenant_id: T, agent_id: agent[name].id, status: "active", version: 1, created_at: ago(30), ...c }), "contract insert");
  bump("contracts");
  const months = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[c.certification_frequency];
  const due = new Date(now);
  due.setUTCMonth(due.getUTCMonth() + months);
  must(await db.from("agents").update({ next_review_at: due.toISOString() }).eq("id", agent[name].id).eq("tenant_id", T).is("next_review_at", null), "next review");
}

// ---------------------------------------------------------------- identities and relationships
const IDENTITIES = [
  ["ITOpsRunbookAgent", "workload_identity", "spiffe://wonderark/itops-runbook", "mcp", "confirmed"],
  ["ITOpsRunbookAgent", "oauth_client", "servicenow-oauth-itops", "saviynt", "probable"],
  ["ProcurementCopilot", "service_account", "svc-procurement-ai@coupa", "saviynt", "confirmed"],
  ["CodeReviewAgent", "oauth_client", "github-app-code-review", "generic_rest", "confirmed"],
  ["InvoiceReconciler", "service_account", "svc-invoice-recon@sap", "saviynt", "unverified"],
];
for (const [name, identity_type, external_reference, source_system, confidence] of IDENTITIES) {
  await ensure("agent_identities", { agent_id: agent[name].id, external_reference, source_system }, { identity_type, confidence, status: "active" }, "identities");
}
const RELATIONSHIPS = [
  ["FinanceBot", "orchestrates", "InvoiceReconciler"],
  ["CodeReviewAgent", "shares_credential_with", "ITOpsRunbookAgent"], // a real suspicious-delegation signal
  ["ITOpsRunbookAgent", "depends_on", "CustomerSupportBot"],
];
const rel = {};
for (const [from, relationship_type, to] of RELATIONSHIPS) {
  if (!agent[from] || !agent[to]) continue;
  rel[`${from}:${to}`] = await ensure("agent_relationships", { agent_id: agent[from].id, related_agent_id: agent[to].id, relationship_type }, {}, "relationships");
}

// ---------------------------------------------------------------- accounts and grants (CAN)
// [agent, app, account ref, [entitlement, grant type]...]
const HOLDINGS = [
  ["FinanceBot", "Snowflake", "svc-finance-ai@snowflake", [["Financial_Reporting_READ", "direct"], ["CustomerDB_READ", "direct"]]],
  ["FinanceBot", "SAP", "svc-finance-ai@sap", [["SAP_READ", "direct"]]],
  ["ITOpsRunbookAgent", "ServiceNow", "svc-itops-runbook", [["Incident_WRITE", "role"], ["CMDB_READ", "role"], ["read_logs", "mcp_tool_permission"], ["restart_service", "mcp_tool_permission"], ["delete_vm", "mcp_tool_permission"]]],
  ["ITOpsRunbookAgent", "Slack", "itops-runbook-bot", [["chat_WRITE", "oauth_scope"]]],
  ["ProcurementCopilot", "Coupa", "svc-procurement-ai", [["PO_CREATE", "role"], ["Supplier_READ", "direct"]]],
  ["CodeReviewAgent", "GitHub", "github-app-code-review", [["repo_READ", "oauth_scope"], ["pull_request_WRITE", "oauth_scope"]]],
  ["InvoiceReconciler", "SAP", "svc-invoice-recon", [["AP_Invoice_READ", "direct"], ["SAP_READ", "group"]]],
];
const grant = {};
for (const [name, appName, ref, holdings] of HOLDINGS) {
  const account = await ensure("accounts", { agent_id: agent[name].id, application_id: app[appName].id }, { external_account_ref: ref, status: "active" }, "accounts");
  for (const [entName, grant_type] of holdings) {
    grant[`${name}:${entName}`] = await ensure(
      "access_grants",
      { account_id: account.id, entitlement_id: ent[entName].id, revoked_at: null },
      { grant_type, source_integration_id: saviynt.id, granted_at: ago(35) },
      "grants",
    );
  }
}
// FinanceBot's existing CustomerDB grant, if present, backs its finding.
const financeCustomerGrant = agent.FinanceBot
  ? must(
      await db
        .from("access_grants")
        .select("id, accounts!inner(agent_id)")
        .eq("tenant_id", T)
        .eq("entitlement_id", ent.CustomerDB_READ.id)
        .eq("accounts.agent_id", agent.FinanceBot.id)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle(),
      "financebot grant",
    )
  : null;

// ---------------------------------------------------------------- runtime activity (DID)
// Deterministic: a fixed-seed generator, so a re-run produces the same
// dedupe keys and inserts nothing new.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const PATTERNS = {
  FinanceBot: [
    { source: "mcp", mcp_server: "finance-mcp", tool: "query_ledger", application: "Snowflake", resource: "FINANCE_DW", action: "read", data_classification: "financial", event_type: "TOOL_EXECUTED" },
    { source: "mcp", mcp_server: "finance-mcp", tool: "get_report", application: "SAP", resource: "GL_Reports", action: "read", data_classification: "financial", event_type: "TOOL_EXECUTED" },
    { source: "mcp", mcp_server: "finance-mcp", tool: "query_ledger", application: "Snowflake", resource: "CustomerDB", action: "read", data_classification: "pii", event_type: "DATA_ACCESS", weight: 0.35 },
  ],
  CustomerSupportBot: [
    { source: "rest", application: "Zendesk", resource: "Tickets", action: "read", data_classification: "internal", event_type: "API_CALL" },
    { source: "rest", application: "Zendesk", resource: "Tickets", action: "write", data_classification: "internal", event_type: "API_CALL" },
  ],
  ITOpsRunbookAgent: [
    { source: "mcp", mcp_server: "itops-mcp", tool: "read_logs", application: "ServiceNow", resource: "payments-api", action: "read", data_classification: "internal", event_type: "TOOL_EXECUTED" },
    { source: "mcp", mcp_server: "itops-mcp", tool: "create_incident", application: "ServiceNow", resource: "INC", action: "create", data_classification: "internal", event_type: "TOOL_EXECUTED" },
    { source: "mcp", mcp_server: "itops-mcp", tool: "restart_service", application: "ServiceNow", resource: "payments-api", action: "restart", data_classification: "internal", event_type: "TOOL_EXECUTED", weight: 0.4, failEvery: 4 },
  ],
  ProcurementCopilot: [
    { source: "rest", tool: "search_suppliers", application: "Coupa", resource: "Suppliers", action: "read", data_classification: "internal", event_type: "API_CALL" },
    { source: "rest", tool: "create_po", application: "Coupa", resource: "PurchaseOrders", action: "create", data_classification: "financial", event_type: "API_CALL", weight: 0.5, failEvery: 5 },
  ],
  CodeReviewAgent: [
    { source: "webhook", tool: "read_diff", application: "GitHub", resource: "wonderark/platform", action: "read", data_classification: "internal", event_type: "API_CALL" },
    { source: "webhook", tool: "comment_on_pr", application: "GitHub", resource: "wonderark/platform", action: "comment", data_classification: "internal", event_type: "API_CALL" },
    { source: "webhook", tool: "merge_pull_request", application: "GitHub", resource: "wonderark/platform", action: "merge", data_classification: "internal", event_type: "API_CALL", weight: 0.25 },
  ],
  RogueDataMinerBot: [
    { source: "mcp", mcp_server: "mcp-rogue-dataminer", tool: "export_records", application: "Salesforce", resource: "Contacts", action: "read", data_classification: "pii", event_type: "DATA_ACCESS", weight: 0.6 },
  ],
};
const eventIds = {};
for (const [name, patterns] of Object.entries(PATTERNS)) {
  if (!agent[name]) continue;
  const rows = [];
  for (let day = 13; day >= 0; day--) {
    for (const [i, p] of patterns.entries()) {
      const perDay = 1 + Math.floor(rand() * 3);
      for (let n = 0; n < perDay; n++) {
        if (rand() > (p.weight ?? 0.9)) continue;
        const { weight, failEvery, ...fields } = p;
        void weight;
        const event_time = ago(day, Math.floor(rand() * 20) + 1);
        rows.push({
          tenant_id: T,
          agent_id: agent[name].id,
          event_time,
          received_at: event_time,
          // Some restarts and PO creations fail. Decided by the event's own
          // key, not the generator, so re-runs stay identical.
          success: !(failEvery && (day + n) % failEvery === 0),
          raw: { demo: true, ...fields },
          dedupe_key: `demo:${name}:${day}:${i}:${n}`,
          session_id: `sess-${name.toLowerCase()}-${day}`,
          ...fields,
        });
      }
    }
  }
  const keys = rows.map((r) => r.dedupe_key);
  const existing = must(await db.from("runtime_events").select("dedupe_key").eq("tenant_id", T).in("dedupe_key", keys), "events existing");
  const have = new Set(existing.map((e) => e.dedupe_key));
  const fresh = rows.filter((r) => !have.has(r.dedupe_key));
  if (fresh.length) {
    must(await db.from("runtime_events").insert(fresh), "events insert");
    bump("runtime_events", fresh.length);
  }
  const ids = must(await db.from("runtime_events").select("id, tool, resource, event_time").eq("tenant_id", T).eq("agent_id", agent[name].id).like("dedupe_key", "demo:%").order("event_time", { ascending: false }), "events ids");
  eventIds[name] = ids;
  const last = ids[0]?.event_time;
  if (last) must(await db.from("agents").update({ last_seen_at: last }).eq("id", agent[name].id).eq("tenant_id", T), "last seen");
}

// Shadow AI (IDENTITY-P0-12): activity from agents nobody registered.
const SHADOW = [
  ["marketing-gpt-sidecar", "mcp", "send_campaign_email", "Salesforce", 4],
  ["excel-copilot-macro", "rest", "read_workbook", "S3", 2],
];
for (const [ref, src, tool, application, n] of SHADOW) {
  for (let i = 0; i < n; i++) {
    const key = `demo:shadow:${ref}:${i}`;
    const found = must(await db.from("runtime_event_quarantine").select("id").eq("tenant_id", T).eq("attempted_dedupe_key", key).maybeSingle(), "quarantine find");
    if (found) continue;
    must(
      await db.from("runtime_event_quarantine").insert({
        tenant_id: T,
        reason: "UNREGISTERED_AGENT",
        source: src,
        action: "read",
        submitted_event_time: ago(i + 1, 2),
        attempted_dedupe_key: key,
        observed_agent_ref: ref,
        application,
        tool,
      }),
      "quarantine insert",
    );
    bump("shadow_ai_events");
  }
}

// ---------------------------------------------------------------- runtime policies
const POLICIES = [
  {
    name: "Block destructive infrastructure tools",
    description: "No agent may delete infrastructure through a tool call.",
    policy_category: "runtime",
    severity: "critical",
    action: "block",
    priority: 100,
    status: "active",
    scope: { targets: [{ type: "MCP_TOOL", value: "itops-mcp:delete_vm" }, { type: "TOOL", value: "delete_vm" }] },
    rule: { field: "request.mutating", op: "eq", value: true },
  },
  {
    name: "Customer PII is read-only",
    description: "Requests touching the customer database are limited to reads.",
    policy_category: "runtime",
    severity: "high",
    action: "restrict",
    priority: 50,
    status: "active",
    scope: { targets: [{ type: "DATA_RESOURCE", value: "CustomerDB" }] },
    rule: { field: "request.data_classification", op: "eq", value: "pii" },
  },
  {
    name: "Flag production journal postings",
    description: "Record every journal posting attempted by an agent in production.",
    policy_category: "runtime",
    severity: "medium",
    action: "flag",
    priority: 10,
    status: "active",
    scope: { targets: [{ type: "TOOL", value: "post_journal_entry" }] },
    rule: { field: "request.environment", op: "eq", value: "production" },
  },
  {
    name: "Merges need a human",
    description: "Draft: block automated merges once reviewed.",
    policy_category: "runtime",
    severity: "high",
    action: "block",
    priority: 60,
    status: "draft",
    scope: { targets: [{ type: "TOOL", value: "merge_pull_request" }] },
    rule: { field: "request.action", op: "eq", value: "merge" },
  },
];
const policy = {};
for (const { rule, name, ...p } of POLICIES) {
  const row = await ensure("policies", { name }, { ...p, owner_id: lead, version: 1, effective_date: ago(20) }, "policies");
  policy[name] = row;
  const rules = must(await db.from("policy_rules").select("id").eq("policy_id", row.id), "rules");
  if (!rules.length) {
    must(await db.from("policy_rules").insert({ policy_id: row.id, rule_type: "abac", condition: rule }), "rule insert");
    bump("policy_rules");
  }
}

// ---------------------------------------------------------------- findings (with evidence)
async function finding(name, category, severity, risk_score, title, explanation, recommendation, reasons, evidence, { daysAgo = 2 } = {}) {
  if (!agent[name]) return null;
  const row = await ensure(
    "risk_findings",
    { agent_id: agent[name].id, title },
    { category, severity, risk_score, reasons, explanation, recommendation, status: "open", evaluator_version: 2, created_at: ago(daysAgo) },
    "findings",
  );
  const have = must(await db.from("risk_evidence").select("id").eq("finding_id", row.id).limit(1), "evidence");
  if (!have.length && evidence.length) {
    must(await db.from("risk_evidence").insert(evidence.filter((e) => e.reference_id).map((e) => ({ finding_id: row.id, ...e }))), "evidence insert");
    bump("evidence", evidence.length);
  }
  return row;
}
const latest = (name, tool) => eventIds[name]?.find((e) => !tool || e.tool === tool || e.resource === tool);
const findings = {};
findings.financeCan = await finding(
  "FinanceBot",
  "excessive_access",
  "critical",
  92,
  "FinanceBot can read CustomerDB (PII) outside its financial-reporting purpose",
  "FinanceBot is approved for financial reporting data only (SHOULD). It holds CustomerDB_READ on Snowflake (CAN), and runtime activity shows it reading CustomerDB (DID).",
  "Remove the CustomerDB_READ entitlement through Saviynt, then re-evaluate.",
  ["Production environment access", "Sensitive data (PII) involved", "Access outside the approved contract", "Access was used at runtime"],
  [
    { evidence_type: "access_grant", reference_id: financeCustomerGrant?.id, summary: "CustomerDB_READ on Snowflake (direct grant)" },
    { evidence_type: "runtime_event", reference_id: latest("FinanceBot", "CustomerDB")?.id, summary: "READ Snowflake/CustomerDB" },
  ],
  { daysAgo: 11 },
);
findings.itopsDelete = await finding(
  "ITOpsRunbookAgent",
  "excessive_access",
  "high",
  74,
  "ITOpsRunbookAgent can delete virtual machines it is never approved to delete",
  "The contract prohibits delete actions and does not list delete_vm, but the agent holds the delete_vm MCP tool permission on itops-mcp, which the server declares destructive.",
  "Remove the delete_vm tool permission; keep the runtime block policy in place.",
  ["Destructive capability", "Capability outside the approved contract", "Business criticality critical"],
  [{ evidence_type: "access_grant", reference_id: grant["ITOpsRunbookAgent:delete_vm"]?.id, summary: "delete_vm (mcp_tool_permission) on itops-mcp" }],
  { daysAgo: 6 },
);
findings.codeTool = await finding(
  "CodeReviewAgent",
  "unapproved_tool_use",
  "medium",
  52,
  "CodeReviewAgent used tools outside its contract",
  "CodeReviewAgent used merge_pull_request, which is not among its approved tools (read_diff, comment_on_pr); its contract prohibits merges.",
  "Confirm whether merges are needed; if not, remove pull_request_WRITE and publish the draft merge policy.",
  ["Unapproved tool used at runtime", "Prohibited action"],
  [{ evidence_type: "runtime_event", reference_id: latest("CodeReviewAgent", "merge_pull_request")?.id, summary: "merge_pull_request on wonderark/platform" }],
  { daysAgo: 4 },
);
findings.codeDelegation = await finding(
  "CodeReviewAgent",
  "suspicious_delegation",
  "high",
  66,
  "CodeReviewAgent has suspicious delegation",
  "CodeReviewAgent shares a credential with ITOpsRunbookAgent, so its actions cannot be attributed to it alone.",
  "Give each agent its own credential.",
  ["Shared credential"],
  [{ evidence_type: "agent_relationship", reference_id: rel["CodeReviewAgent:ITOpsRunbookAgent"]?.id, summary: "shares credential with → ITOpsRunbookAgent" }],
  { daysAgo: 9 },
);
findings.procOwner = await finding(
  "ProcurementCopilot",
  "ownership_violation",
  "medium",
  40,
  "ProcurementCopilot has no technical owner",
  "A production agent needs both a business and a technical owner; ProcurementCopilot has only a business owner.",
  "Assign a technical owner on the agent's Overview tab.",
  ["Missing required owner", "Production environment"],
  [{ evidence_type: "ownership_fact", reference_id: agent.ProcurementCopilot?.id, summary: "technical_owner missing" }],
  { daysAgo: 18 },
);

// ---------------------------------------------------------------- investigations
async function investigation(title, priority, status, summary, findingRows) {
  const existing = must(await db.from("investigations").select("id").eq("tenant_id", T).eq("title", title).maybeSingle(), "investigation find");
  if (existing) return existing;
  const year = new Date(now).getUTCFullYear();
  const refs = must(await db.from("investigations").select("reference").eq("tenant_id", T).like("reference", `INV-${year}-%`), "refs");
  const next = Math.max(0, ...refs.map((r) => Number(r.reference.split("-")[2]) || 0)) + 1;
  const reference = `INV-${year}-${String(next).padStart(3, "0")}`;
  const row = must(
    await db.from("investigations").insert({ tenant_id: T, reference, title, summary, status, priority, assignee_id: lead, created_by: lead, created_at: ago(1), updated_at: ago(0, 3) }).select().single(),
    "investigation insert",
  );
  bump("investigations");
  const ids = findingRows.filter(Boolean).map((f) => f.id);
  if (ids.length) must(await db.from("investigation_findings").insert(ids.map((finding_id) => ({ investigation_id: row.id, finding_id, tenant_id: T, added_by: lead }))), "investigation findings");
  must(
    await db.from("investigation_events").insert([
      { tenant_id: T, investigation_id: row.id, actor_id: lead, event_type: "created", detail: { reference, priority, findingIds: ids }, created_at: ago(1) },
      ...(status !== "open" ? [{ tenant_id: T, investigation_id: row.id, actor_id: lead, event_type: "status_changed", detail: { from: "open", to: status }, created_at: ago(0, 5) }] : []),
      { tenant_id: T, investigation_id: row.id, actor_id: lead, event_type: "note", detail: { note: "Seeded for the demo organization." }, created_at: ago(0, 4) },
    ]),
    "investigation events",
  );
  return row;
}
await investigation(
  "FinanceBot reading customer PII",
  "critical",
  "in_progress",
  "FinanceBot holds and uses CustomerDB access outside its financial-reporting purpose. Removal requested through Saviynt.",
  [findings.financeCan],
);
await investigation(
  "Destructive capability on ITOpsRunbookAgent",
  "high",
  "open",
  "delete_vm is held but never approved. Confirm nobody relies on it before removal.",
  [findings.itopsDelete, findings.codeDelegation],
);

// ---------------------------------------------------------------- certification and controls
const campaign = await ensure(
  "certification_campaigns",
  { name: "Q4 2026 production agent access review" },
  { scope_type: "privileged_access", scope: { environment: "production" }, cadence: "periodic", status: "active", due_date: ahead(21), created_by: lead, created_at: ago(4) },
  "campaigns",
);
const REVIEW = [
  ["ITOpsRunbookAgent", "delete_vm", "high", "never", "remove"],
  ["ITOpsRunbookAgent", "restart_service", "medium", "used", "keep"],
  ["ProcurementCopilot", "PO_CREATE", "medium", "used", "review"],
  ["CodeReviewAgent", "pull_request_WRITE", "medium", "used", "review"],
];
for (const [name, entName, risk, usage, recommendation] of REVIEW) {
  const g = grant[`${name}:${entName}`];
  if (!g) continue;
  await ensure(
    "certification_items",
    { campaign_id: campaign.id, agent_id: agent[name].id, access_grant_id: g.id },
    { reviewer_id: second, risk_at_review: risk, usage_at_review: usage, recommendation, status: "pending", due_date: ahead(21) },
    "certification_items",
  );
}
const controls = must(await db.from("controls").select("id, control_ref, framework_id").in("framework_id", ["iso27001", "iso42001", "nist_ai_rmf"]).order("control_ref"), "controls");
const existingMappings = must(await db.from("control_mappings").select("control_id, policy_id").eq("tenant_id", T), "mappings");
const mapped = new Set(existingMappings.map((m) => m.control_id));
// Keyed by policy: a policy already mapped is left alone on a re-run.
const mappedPolicies = new Set(existingMappings.map((m) => m.policy_id).filter(Boolean));
const MAP = [
  ["iso27001", "Block destructive infrastructure tools", "compliant"],
  ["iso42001", "Customer PII is read-only", "partial"],
  ["nist_ai_rmf", "Flag production journal postings", "no_evidence"],
];
for (const [framework, policyName, status] of MAP) {
  const control = controls.find((c) => c.framework_id === framework && !mapped.has(c.id));
  if (!control || !policy[policyName] || mappedPolicies.has(policy[policyName].id)) continue;
  must(await db.from("control_mappings").insert({ tenant_id: T, control_id: control.id, policy_id: policy[policyName].id, status, owner_id: lead }), "mapping insert");
  mapped.add(control.id);
  bump("control_mappings");
}

// ---------------------------------------------------------------- real gateway decisions
if (args.gateway) {
  const base = args.gateway.replace(/\/$/, "");
  const REQUESTS = {
    FinanceBot: [
      { action: "read", application: "Snowflake", resource: "FINANCE_DW", tool: "query_ledger", mcpServer: "finance-mcp", dataClassification: "financial" },
      { action: "read", application: "Snowflake", resource: "CustomerDB", tool: "query_ledger", mcpServer: "finance-mcp", dataClassification: "pii" },
      { action: "post", application: "SAP", resource: "GL", tool: "post_journal_entry", mcpServer: "finance-mcp", dataClassification: "financial" },
    ],
    ITOpsRunbookAgent: [
      { action: "read", application: "ServiceNow", resource: "payments-api", tool: "read_logs", mcpServer: "itops-mcp", dataClassification: "internal" },
      { action: "restart", application: "ServiceNow", resource: "payments-api", tool: "restart_service", mcpServer: "itops-mcp", dataClassification: "internal" },
      { action: "delete", application: "ServiceNow", resource: "vm-payments-03", tool: "delete_vm", mcpServer: "itops-mcp", dataClassification: "internal" },
    ],
    ProcurementCopilot: [
      { action: "read", application: "Coupa", resource: "Suppliers", tool: "search_suppliers", dataClassification: "internal" },
      { action: "create", application: "Coupa", resource: "PurchaseOrders", tool: "create_po", dataClassification: "financial" },
    ],
    CodeReviewAgent: [
      { action: "comment", application: "GitHub", resource: "wonderark/platform", tool: "comment_on_pr", dataClassification: "internal" },
      { action: "merge", application: "GitHub", resource: "wonderark/platform", tool: "merge_pull_request", dataClassification: "internal" },
    ],
    CustomerSupportBot: [{ action: "read", application: "Zendesk", resource: "Tickets", dataClassification: "internal" }],
    RogueDataMinerBot: [{ action: "read", application: "Salesforce", resource: "Contacts", tool: "export_records", dataClassification: "pii" }],
  };
  for (const [name, requests] of Object.entries(REQUESTS)) {
    if (!agent[name]) continue;
    // A fresh key per run (the secret exists only in this process); older
    // demo keys for the agent are revoked so exactly one stays active.
    const secret = "wa_ak_" + randomBytes(32).toString("base64url");
    const key = must(
      await db
        .from("agent_api_keys")
        .insert({ tenant_id: T, agent_id: agent[name].id, name: "Demo gateway key", key_prefix: secret.slice(0, 12), key_hash: createHash("sha256").update(secret, "utf8").digest("hex"), created_by: lead })
        .select("id")
        .single(),
      "key insert",
    );
    must(
      await db
        .from("agent_api_keys")
        .update({ revoked_at: new Date().toISOString(), revoked_by: lead, revoked_reason: "Replaced by a newer demo key" })
        .eq("tenant_id", T)
        .eq("agent_id", agent[name].id)
        .eq("name", "Demo gateway key")
        .is("revoked_at", null)
        .neq("id", key.id),
      "key rotate",
    );
    bump("api_keys");
    for (const [i, req] of requests.entries()) {
      const res = await fetch(`${base}/api/gateway/v1/authorize`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ requestId: `demo-v2-${name}-${i}`, ...req, context: { source: "demo-seed" } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn(`  gateway ${name} #${i}: HTTP ${res.status} ${body?.error?.code ?? ""}`);
        continue;
      }
      bump(body.data.replayed ? "gateway_replayed" : "gateway_decisions");
      console.log(`  gateway ${name} ${req.action} ${req.tool ?? req.resource}: ${body.data.decision} (${body.data.code})${body.data.replayed ? " [replayed]" : ""}`);
    }
  }
}

// ---------------------------------------------------------------- record it (#11)
must(
  await db.from("audit_logs").insert({
    tenant_id: T,
    actor_id: null,
    actor_type: "system",
    action: "demo.data_seeded",
    object_type: "tenant",
    object_id: T,
    outcome: "success",
    metadata: { script: "scripts/seed-demo-data.mjs", created: counts },
  }),
  "audit",
);
console.log("Created:", Object.keys(counts).length ? counts : "nothing new (already seeded)");
