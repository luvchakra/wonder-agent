import { CANONICAL_FIELDS, type ResourceKind } from "@/modules/integrations/framework/types";

/**
 * Object-page CSV export and import registry (2026-10-10, user requirement:
 * "csv should be allowed to be imported in the ui directly for each object,
 * page for each object should have an action drop down with import and
 * export options").
 *
 * One entry per object list page. Each names where its rows come from, the
 * columns written (header → database field), and the read permission the
 * page itself checks. Pure data: no database client here, so the registry
 * is unit-tested on its own and `objectActionsFor()` can run in any page.
 *
 * Every table source is read through the signed-in user's client
 * (`supabaseServer()`), so RLS applies, with an explicit `tenant_id` filter
 * on top (CLAUDE.md §14). There is no service-role source; the tenant's user
 * directory is therefore not exportable here (it is served only through a
 * service-role RPC).
 *
 * Importable kinds write their columns under the canonical field names of
 * the connector framework (`CANONICAL_FIELDS`), so an exported file can be
 * imported back unchanged. Imports themselves run through the framework
 * (`POST /api/v1/imports`, non-negotiable #20); this module only exports.
 */

/** Exporting is an extra, sensitive permission on top of the page's read permission (as for every export path). */
export const EXPORT_PERMISSION = "report.export";
/** Starting a CSV import runs a connector job. */
export const IMPORT_PERMISSION = "integration.execute";
/** Importing also adds and updates the page's records, so it needs the permission that manages them. */
export const IMPORT_MANAGE_PERMISSIONS: Record<ImportKind, string> = {
  identity: "identity.manage",
  application: "access.manage",
  entitlement: "access.manage",
  account: "access.manage",
  access_grant: "access.manage",
};
export const EXPORT_CHUNK_SIZE = 1000;
export const EXPORT_ROW_CAP = 50_000;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportKind = Extract<ResourceKind, "identity" | "account" | "entitlement" | "access_grant" | "application">;

/** A label resolved from another tenant table, by id, in the same tenant. */
export type ExportLookup = { table: string; label: string; fallbackToId?: boolean };

export type ExportColumn = {
  header: string;
  /** Database column; for a lookup, the id column it resolves. */
  field: string;
  /** A second column used when `field` is empty (e.g. an external id, else the WonderID id). */
  fallback?: string;
  lookup?: ExportLookup;
};

export type ExportParamFilter = { param: string; column: string; allowed: readonly string[] };

export type TableSource = {
  table: string;
  /** Order for range paging; `id` is always the tie-breaker. */
  orderBy?: { column: string; ascending: boolean };
  where?: { column: string; in: readonly string[] }[];
  whereNull?: string[];
  /** Simple query-string filters the page itself uses (values checked against `allowed`). */
  params?: ExportParamFilter[];
  /** System rows (tenant_id null) are part of the list, e.g. built-in roles. */
  includeGlobal?: boolean;
};

/** Pages whose list is computed by the owning module's published service (still user-scoped). */
export type ServiceSource = { service: "nhi_inventory" | "mcp_inventory" };

export type ExportEntry = {
  key: string;
  /** Plural noun for menu labels when a page offers several objects. */
  label: string;
  /** The page's own read permission. */
  permission: string;
  /** Audit action prefix: `<auditModule>.exported`. */
  auditModule: string;
  source: TableSource | ServiceSource;
  columns: readonly ExportColumn[];
  importKind?: ImportKind;
};

const col = (header: string, field: string, extra: Partial<ExportColumn> = {}): ExportColumn => ({ header, field, ...extra });
const identityName: ExportLookup = { table: "identities", label: "display_name" };
const applicationName: ExportLookup = { table: "applications", label: "name" };
const entitlementName: ExportLookup = { table: "entitlements", label: "name" };
const agentName: ExportLookup = { table: "agents", label: "agent_name" };

const IDENTITY_STATUS_PARAM: ExportParamFilter = {
  param: "status",
  column: "status",
  allowed: ["pending", "active", "inactive", "disabled", "terminated", "archived"],
};

const IDENTITY_COLUMNS: readonly ExportColumn[] = [
  col("externalId", "source_native_id", { fallback: "id" }),
  col("displayName", "display_name"),
  col("email", "email"),
  col("username", "username"),
  col("identityType", "identity_type"),
  col("subtype", "subtype"),
  col("title", "title"),
  col("department", "department"),
  col("businessUnit", "business_unit"),
  col("location", "location"),
  col("employmentType", "employment_type"),
  col("organization", "organization"),
  col("startDate", "start_date"),
  col("endDate", "end_date"),
  col("status", "status"),
];

function identityEntry(key: string, label: string, types: readonly string[]): ExportEntry {
  return {
    key,
    label,
    permission: "identity.read",
    auditModule: "identity",
    importKind: "identity",
    source: {
      table: "identities",
      orderBy: { column: "display_name", ascending: true },
      where: types.length ? [{ column: "identity_type", in: types }] : undefined,
      params: [IDENTITY_STATUS_PARAM],
    },
    columns: IDENTITY_COLUMNS,
  };
}

const ENTRIES: readonly ExportEntry[] = [
  {
    key: "agents",
    label: "agents",
    permission: "agent.read",
    auditModule: "agent",
    source: { table: "agents", orderBy: { column: "agent_name", ascending: true } },
    columns: [
      col("Name", "agent_name"),
      col("Display name", "display_name"),
      col("Type", "agent_type"),
      col("Framework", "agent_framework"),
      col("Model provider", "model_provider"),
      col("Environment", "environment"),
      col("Criticality", "criticality"),
      col("Lifecycle state", "lifecycle_state"),
      col("Status", "status"),
      col("Source system", "source_system"),
      col("Risk score", "risk_score"),
      col("Last seen", "last_seen_at"),
      col("Created", "created_at"),
    ],
  },
  {
    key: "non-human-identities",
    label: "non-human identities",
    permission: "agent.read",
    auditModule: "agent",
    source: { service: "nhi_inventory" },
    columns: [
      col("Name", "displayName"),
      col("External reference", "externalReference"),
      col("Type", "identityType"),
      col("Source", "sourceName"),
      col("Status", "status"),
      col("Agent", "agentName"),
      col("Owner", "owner"),
      col("Last seen", "lastSeenAt"),
    ],
  },
  identityEntry("identities", "identities", []),
  identityEntry("people", "people", ["HUMAN"]),
  identityEntry("external-identities", "external identities", ["EXTERNAL"]),
  identityEntry("machine-identities", "machine identities", ["SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"]),
  {
    key: "lifecycle-tasks",
    label: "lifecycle tasks",
    permission: "identity.read",
    auditModule: "identity",
    source: { table: "identity_lifecycle_tasks", orderBy: { column: "created_at", ascending: false } },
    columns: [
      col("Task", "task_type"),
      col("Status", "status"),
      col("Identity", "identity_id", { lookup: identityName }),
      col("Assignee", "assignee_identity_id", { lookup: identityName }),
      col("Created", "created_at"),
      col("Completed", "completed_at"),
      col("Resolution note", "resolution_note"),
    ],
  },
  {
    key: "identity-attributes",
    label: "identity attributes",
    permission: "identity.read",
    auditModule: "identity",
    source: { table: "identity_attribute_definitions", orderBy: { column: "name", ascending: true } },
    columns: [
      col("Name", "name"),
      col("Display name", "display_name"),
      col("Identity type", "identity_type"),
      col("Data type", "data_type"),
      col("Required", "required"),
      col("Sensitive", "sensitive"),
      col("Searchable", "searchable"),
      col("Unique", "unique_value"),
      col("Allowed values", "allowed_values"),
      col("Active", "active"),
    ],
  },
  {
    key: "applications",
    label: "applications",
    permission: "access.read",
    auditModule: "access",
    importKind: "application",
    source: { table: "applications", orderBy: { column: "name", ascending: true } },
    columns: [col("externalId", "id"), col("name", "name"), col("category", "category"), col("description", "description")],
  },
  {
    key: "entitlements",
    label: "entitlements",
    permission: "access.read",
    auditModule: "access",
    importKind: "entitlement",
    source: { table: "entitlements", orderBy: { column: "name", ascending: true } },
    columns: [
      col("externalId", "id"),
      col("name", "name"),
      col("application", "application_id", { lookup: applicationName }),
      col("privilegeLevel", "privilege_level"),
      col("dataClassification", "data_classification"),
    ],
  },
  {
    key: "access-grants",
    label: "access grants",
    permission: "access.read",
    auditModule: "access",
    importKind: "access_grant",
    source: { table: "access_grants", orderBy: { column: "granted_at", ascending: false }, whereNull: ["revoked_at"] },
    columns: [
      col("externalId", "id"),
      col("accountExternalId", "account_id", { lookup: { table: "accounts", label: "external_account_ref", fallbackToId: true } }),
      col("entitlementExternalId", "entitlement_id"),
      col("grantType", "grant_type"),
    ],
  },
  {
    key: "accounts",
    label: "accounts",
    permission: "access.read",
    auditModule: "access",
    importKind: "account",
    source: { table: "accounts", orderBy: { column: "created_at", ascending: false } },
    columns: [
      col("externalId", "external_account_ref", { fallback: "id" }),
      col("application", "application_id", { lookup: applicationName }),
      col("username", "account_name"),
      col("owner", "identity_id", { lookup: identityName }),
      col("status", "status"),
      col("accountType", "account_type"),
      col("lastLoginAt", "last_used_at"),
      col("createdAt", "created_at"),
    ],
  },
  {
    key: "access-requests",
    label: "access requests",
    permission: "access.read",
    auditModule: "access",
    source: { table: "access_requests", orderBy: { column: "created_at", ascending: false } },
    columns: [
      col("Type", "request_type"),
      col("For", "subject_identity_id", { lookup: identityName }),
      col("Application", "application_id", { lookup: applicationName }),
      col("Entitlement", "entitlement_id", { lookup: entitlementName }),
      col("Status", "status"),
      col("Risk", "risk_level"),
      col("Justification", "justification"),
      col("Duration (days)", "duration_days"),
      col("Requested", "created_at"),
      col("Decided", "decided_at"),
    ],
  },
  {
    key: "access-packages",
    label: "access packages",
    permission: "access.read",
    auditModule: "access",
    source: { table: "access_packages", orderBy: { column: "name", ascending: true } },
    columns: [
      col("Name", "name"),
      col("Description", "description"),
      col("Status", "status"),
      col("Requestable", "requestable"),
      col("Owner", "owner_identity_id", { lookup: identityName }),
      col("Approval", "approval"),
      col("Max duration (days)", "max_duration_days"),
      col("Certification", "certification_frequency"),
      col("Created", "created_at"),
    ],
  },
  {
    key: "request-policies",
    label: "request policies",
    permission: "access.read",
    auditModule: "access",
    source: { table: "access_request_policies", orderBy: { column: "name", ascending: true } },
    columns: [
      col("Name", "name"),
      col("Application", "application_id", { lookup: applicationName }),
      col("Entitlement", "entitlement_id", { lookup: entitlementName }),
      col("Requestable", "requestable"),
      col("Justification required", "justification_required"),
      col("Risk threshold", "risk_threshold"),
      col("Auto approve", "auto_approve"),
      col("Approval", "approval"),
      col("Status", "status"),
    ],
  },
  {
    key: "data-sources",
    label: "data sources",
    permission: "access.read",
    auditModule: "access",
    source: { table: "data_sources", orderBy: { column: "name", ascending: true } },
    columns: [
      col("Name", "name"),
      col("Kind", "kind"),
      col("Classification", "classification"),
      col("Owner", "owner"),
      col("Application", "application_id", { lookup: applicationName }),
      col("External reference", "external_ref"),
      col("Status", "status"),
      col("Created", "created_at"),
    ],
  },
  {
    key: "policies",
    label: "policies",
    permission: "policy.read",
    auditModule: "policy",
    source: { table: "policies", orderBy: { column: "name", ascending: true } },
    columns: [
      col("Name", "name"),
      col("Category", "policy_category"),
      col("Severity", "severity"),
      col("Action", "action"),
      col("Status", "status"),
      col("Version", "version"),
      col("Effective", "effective_date"),
      col("Expires", "expiry_date"),
      col("Description", "description"),
    ],
  },
  {
    key: "findings",
    label: "findings",
    permission: "risk.read",
    auditModule: "risk",
    source: { table: "risk_findings", orderBy: { column: "created_at", ascending: false } },
    columns: [
      col("Title", "title"),
      col("Severity", "severity"),
      col("Category", "category"),
      col("Risk score", "risk_score"),
      col("Status", "status"),
      col("Agent", "agent_id", { lookup: agentName }),
      col("Recommendation", "recommendation"),
      col("Detected", "created_at"),
      col("Resolved", "resolved_at"),
    ],
  },
  {
    key: "investigations",
    label: "investigations",
    permission: "risk.read",
    auditModule: "risk",
    source: { table: "investigations", orderBy: { column: "created_at", ascending: false } },
    columns: [
      col("Reference", "reference"),
      col("Title", "title"),
      col("Status", "status"),
      col("Priority", "priority"),
      col("Opened", "created_at"),
      col("Resolved", "resolved_at"),
      col("Resolution", "resolution"),
    ],
  },
  {
    key: "runtime-events",
    label: "runtime events",
    permission: "runtime.read",
    auditModule: "runtime",
    source: { table: "runtime_events", orderBy: { column: "event_time", ascending: false } },
    columns: [
      col("Time", "event_time"),
      col("Agent", "agent_id", { lookup: agentName }),
      col("Event", "event_type"),
      col("Source", "source"),
      col("Tool", "tool"),
      col("Application", "application"),
      col("Resource", "resource"),
      col("Action", "action"),
      col("Data classification", "data_classification"),
      col("Succeeded", "success"),
      col("MCP server", "mcp_server"),
    ],
  },
  {
    key: "audit-events",
    label: "audit events",
    permission: "audit.read",
    auditModule: "audit",
    source: { table: "audit_logs", orderBy: { column: "created_at", ascending: false } },
    columns: [
      col("Time", "created_at"),
      col("Actor", "actor_id"),
      col("Actor type", "actor_type"),
      col("Action", "action"),
      col("Object type", "object_type"),
      col("Object", "object_id"),
      col("Outcome", "outcome"),
      col("Correlation", "correlation_id"),
      col("Details", "metadata"),
    ],
  },
  {
    key: "campaigns",
    label: "campaigns",
    permission: "compliance.read",
    auditModule: "compliance",
    source: { table: "certification_campaigns", orderBy: { column: "created_at", ascending: false } },
    columns: [col("Name", "name"), col("Scope", "scope_type"), col("Cadence", "cadence"), col("Status", "status"), col("Due", "due_date"), col("Created", "created_at")],
  },
  {
    key: "integrations",
    label: "integrations",
    permission: "integration.read",
    auditModule: "integration",
    source: { table: "integrations", orderBy: { column: "name", ascending: true } },
    columns: [col("Name", "name"), col("Type", "integration_type_id"), col("Status", "status"), col("Last sync", "last_sync_at"), col("Next sync", "next_sync_at"), col("Created", "created_at")],
  },
  {
    key: "sync-jobs",
    label: "jobs",
    permission: "integration.read",
    auditModule: "integration",
    source: { table: "integration_sync_jobs", orderBy: { column: "created_at", ascending: false } },
    columns: [
      col("Integration", "integration_id", { lookup: { table: "integrations", label: "name" } }),
      col("Trigger", "trigger"),
      col("Status", "status"),
      col("Started", "started_at"),
      col("Ended", "ended_at"),
      col("Records processed", "records_processed"),
      col("Records failed", "records_failed"),
      col("Retries", "retry_count"),
    ],
  },
  {
    key: "identity-sources",
    label: "identity sources",
    permission: "integration.read",
    auditModule: "integration",
    source: { table: "identity_sources", orderBy: { column: "priority", ascending: true } },
    columns: [
      col("Name", "name"),
      col("Template", "template"),
      col("Identity type", "identity_type"),
      col("Authoritative", "authoritative"),
      col("Priority", "priority"),
      col("Schedule", "schedule"),
      col("Leaver strategy", "leaver_strategy"),
      col("Status", "status"),
      col("Created", "created_at"),
    ],
  },
  {
    key: "application-discoveries",
    label: "discovered applications",
    permission: "integration.read",
    auditModule: "integration",
    source: { table: "application_discoveries", orderBy: { column: "last_seen_at", ascending: false } },
    columns: [
      col("Name", "name"),
      col("Vendor", "vendor"),
      col("URL", "url"),
      col("Source", "source"),
      col("Status", "status"),
      col("Sightings", "sightings"),
      col("First seen", "first_seen_at"),
      col("Last seen", "last_seen_at"),
    ],
  },
  {
    key: "mcp-servers",
    label: "MCP servers",
    permission: "integration.read",
    auditModule: "integration",
    source: { service: "mcp_inventory" },
    columns: [
      col("Integration", "integrationName"),
      col("Endpoint", "endpoint"),
      col("Server", "serverName"),
      col("Server version", "serverVersion"),
      col("Protocol version", "protocolVersion"),
      col("Tools", "toolCount"),
      col("Resources", "resourceCount"),
      col("Last discovered", "lastDiscoveredAt"),
    ],
  },
  {
    key: "groups",
    label: "groups",
    permission: "groups.view",
    auditModule: "groups",
    source: { table: "groups", orderBy: { column: "name", ascending: true } },
    columns: [col("Name", "name"), col("Description", "description"), col("Status", "status"), col("Created", "created_at")],
  },
  {
    key: "roles",
    label: "roles",
    permission: "roles.view",
    auditModule: "roles",
    source: { table: "roles", orderBy: { column: "name", ascending: true }, includeGlobal: true },
    columns: [
      col("Name", "name"),
      col("Display name", "display_name"),
      col("Description", "description"),
      col("Built-in", "is_system"),
      col("Status", "status"),
      col("Created", "created_at"),
    ],
  },
  {
    key: "authorization-policies",
    label: "authorization policies",
    permission: "permissions.view",
    auditModule: "permissions",
    source: { table: "authorization_policies", orderBy: { column: "name", ascending: true } },
    columns: [
      col("Name", "name"),
      col("Effect", "effect"),
      col("Permissions", "permissions"),
      col("Scope", "scope_type"),
      col("Scope values", "scope_values"),
      col("Status", "status"),
      col("Updated", "updated_at"),
    ],
  },
];

const BY_KEY = new Map(ENTRIES.map((e) => [e.key, e]));

export const EXPORT_ENTRIES: readonly ExportEntry[] = ENTRIES;

export function getExportEntry(key: string): ExportEntry | null {
  return BY_KEY.get(key) ?? null;
}

export function isTableSource(source: ExportEntry["source"]): source is TableSource {
  return "table" in source;
}

/** Canonical template header for an importable kind: required columns first, then optional, in framework order. */
export function importColumns(kind: ImportKind): { required: string[]; optional: string[] } {
  const spec = CANONICAL_FIELDS[kind];
  return { required: [...spec.required], optional: [...spec.optional] };
}

// ---------------------------------------------------------------------------
// The page header's Actions menu: which items this viewer gets.
// ---------------------------------------------------------------------------

export type ExportMenuItem = { label: string; href: string };
/** `scope`: the page the import starts from (an identity page's type is the default for new identities). */
export type ImportMenuItem = { kind: ImportKind; scope: string; label: string; title: string; required: string[]; optional: string[]; templateHref: string };
export type ObjectActions = { exports: ExportMenuItem[]; imports: ImportMenuItem[] };

/**
 * Menu items for one page. `permissions` is the server-resolved tenant
 * context's list. This only decides what to show; the export route and the
 * import endpoint check the same permissions again.
 * `query` carries the page's own simple filters (only those the entry allows).
 */
export function objectActionsFor(permissions: readonly string[], keys: readonly string[], query: Record<string, string | undefined> = {}): ObjectActions {
  const entries = keys.map((k) => getExportEntry(k)).filter((e): e is ExportEntry => e !== null && permissions.includes(e.permission));
  const several = entries.length > 1;
  const exports: ExportMenuItem[] = [];
  const imports: ImportMenuItem[] = [];
  if (permissions.includes(EXPORT_PERMISSION)) {
    for (const e of entries) {
      const sp = new URLSearchParams();
      if (isTableSource(e.source)) {
        for (const f of e.source.params ?? []) {
          const v = query[f.param];
          if (v && f.allowed.includes(v)) sp.set(f.param, v);
        }
      }
      const qs = sp.toString();
      exports.push({ label: several ? `Export ${e.label}` : "Export CSV", href: `/api/v1/exports/${e.key}${qs ? `?${qs}` : ""}` });
    }
  }
  if (permissions.includes(IMPORT_PERMISSION)) {
    const seen = new Set<ImportKind>();
    for (const e of entries) {
      if (!e.importKind || seen.has(e.importKind) || !permissions.includes(IMPORT_MANAGE_PERMISSIONS[e.importKind])) continue;
      seen.add(e.importKind);
      imports.push({
        kind: e.importKind,
        scope: e.key,
        label: several ? `Import ${e.label}…` : "Import CSV…",
        title: `Import ${e.label}`,
        ...importColumns(e.importKind),
        templateHref: `/api/v1/exports/${e.key}?template=1`,
      });
    }
  }
  return { exports, imports };
}
