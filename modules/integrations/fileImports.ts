import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";
import { MANUAL_IDENTITY_TYPES, SOURCED_IDENTITY_FIELDS, type IdentityType, type SourceAuthority } from "@/lib/shared/types/agent-identity";
import type { ImportApplyRow, ImportCounts, ImportOutcomeCounts, ImportPlanRow, ImportRecord } from "@/lib/shared/types/integrations";
import { applySourcedIdentities, listIdentitiesForCorrelation, previewSourcedIdentities, type SourcedOp } from "@/modules/agent-identity/service";
import { applyAccessImport, previewAccessImport, type AccessImportKind } from "@/modules/access-governance/service";
import { createIntegration } from "./integrations";
import { createSyncJob, runSyncJob } from "./syncJobs";
import { BUILTIN_DEFINITIONS } from "./framework/definitions";
import { capabilitiesOf, parseConnectorConfig } from "./framework/engine";
import { readCsvFile } from "./framework/csv";
import { storeConnectorFile } from "./framework/files";
import { fileColumns } from "./framework/drivers/file";
import { uploadFilename, uploadTarget } from "./framework/receiveRules";
import type { ConnectorIntegrationConfig } from "./framework/types";
import {
  FILE_IMPORTS_NAME,
  FILE_IMPORTS_PURPOSE,
  FileImportInvalidError,
  MAX_IMPORT_BYTES,
  PAGE_IMPORT_MAX_ROWS,
  isImportKind,
  IMPORT_KINDS,
  type ImportKind,
} from "./fileImportRules";
import { FILE_IMPORT_PRIORITY, countDecisions, defaultIdentityType, identityMatcher, invalidRow, mapImportRecords, normalizeImportedIdentity, type ImportedIdentity } from "./fileImportPlan";

/**
 * Importing a CSV from an object page, through the connector framework
 * (non-negotiable #20). Two steps (2026-10-10, user decision):
 *
 * 1. Preview: the file is read and mapped with the File imports
 *    connection's definition, and each record matched against the page's
 *    records. Nothing is stored; the person sees what would be added,
 *    updated, left as it is, or skipped, and confirms or cancels.
 * 2. Import: the file becomes an upload of the tenant's single "File
 *    imports" connection (built-in csv-file), whose sync reads, maps and
 *    stores it like any other connector. What the sync stored is then
 *    applied by the module that owns the records: new records are added
 *    and existing ones updated. Additive only: nothing missing from the
 *    file is removed or deactivated.
 *
 * The caller has checked integration.execute and the page's manage
 * permission; `ctx.tenantId` is the server-resolved tenant (§14).
 */

const CSV_FILE = () => {
  const def = BUILTIN_DEFINITIONS.find((d) => d.key === "csv-file");
  if (!def) throw new Error("The csv-file connector is missing");
  return def;
};

type Connection = { id: string; status: string; config: Record<string, unknown> };

async function findFileImportsConnection(tenantId: string): Promise<Connection | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integrations")
    .select("id, status, config")
    .eq("tenant_id", tenantId)
    .eq("integration_type_id", "connector")
    .eq("config->>purpose", FILE_IMPORTS_PURPOSE)
    .maybeSingle<Connection>();
  if (error) throw new ApiError(500, "QUERY_FAILED", "The File imports connection could not be read");
  return data;
}

/** The tenant's File imports connection, created on first use (one per tenant: a unique index, 0111). */
async function fileImportsConnection(tenantId: string, actorId: string): Promise<Connection> {
  const existing = await findFileImportsConnection(tenantId);
  if (existing) return existing;
  const def = CSV_FILE();
  const config: ConnectorIntegrationConfig & { purpose: string } = {
    definition: { key: def.key, version: def.version, origin: "builtin" },
    settings: {},
    purpose: FILE_IMPORTS_PURPOSE,
  };
  try {
    const created = await createIntegration(tenantId, actorId, {
      integrationTypeId: "connector",
      name: FILE_IMPORTS_NAME,
      config: config as unknown as Record<string, unknown>,
      capabilities: capabilitiesOf(def),
    });
    return { id: created.id, status: created.status, config: config as unknown as Record<string, unknown> };
  } catch (err) {
    // A concurrent first import created it; use that one.
    const raced = await findFileImportsConnection(tenantId);
    if (raced) return raced;
    throw err;
  }
}

/**
 * Checks and maps a file exactly as the connection's sync will: the same
 * definition, settings and column renames. Refuses the whole file (with
 * rows and columns) when it cannot be imported as it is.
 */
async function readImport(tenantId: string, kind: string, csvText: string) {
  if (!isImportKind(kind)) throw new FileImportInvalidError(`kind: one of ${IMPORT_KINDS.join(", ")}`);
  if (Buffer.byteLength(csvText, "utf8") > MAX_IMPORT_BYTES) throw new FileImportInvalidError(`file: larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB`);

  const existing = await findFileImportsConnection(tenantId);
  if (existing?.status === "disabled") throw new ApiError(409, "CONNECTION_DISABLED", "The File imports connection is disabled");
  const { def, settings } = existing ? parseConnectorConfig(existing.config) : { def: CSV_FILE(), settings: {} };
  const target = uploadTarget(def, settings, kind);
  if ("status" in target) throw target.status === 409 ? new ApiError(409, "CONFLICT", target.message) : new FileImportInvalidError(target.message);
  const { records: csvRows, issues } = readCsvFile(target.kind, target.spec, csvText, fileColumns(target.spec, settings));
  if (issues.length) throw new FileImportInvalidError(issues[0].message, issues.slice(0, 20));
  if (csvRows.length === 0) throw new FileImportInvalidError("the file has a header row but no records", [{ row: 2, message: "no records" }]);
  if (csvRows.length > PAGE_IMPORT_MAX_ROWS) {
    throw new FileImportInvalidError(`more than ${PAGE_IMPORT_MAX_ROWS.toLocaleString("en-US")} rows; split the file`, [{ row: PAGE_IMPORT_MAX_ROWS + 2, message: "too many rows" }]);
  }

  const application = typeof settings.application === "string" && settings.application.trim() ? settings.application.trim() : undefined;
  const { records, invalid } = mapImportRecords(target.kind, target.spec.fields, settings, csvRows, { application });
  // A repeated record would be stored once (the last row wins), so the preview could not say what happens to it.
  const repeated = invalid.filter((r) => r.externalId && r.note?.startsWith("the same record"));
  if (repeated.length) {
    throw new FileImportInvalidError(
      "some records appear more than once; keep one row per record",
      repeated.slice(0, 20).map((r) => ({ row: r.row ?? 0, message: `${r.externalId}: ${r.note}` })),
    );
  }
  if ((kind === "account" || kind === "entitlement") && !application && records.every((r) => r.values.application === undefined)) {
    throw new FileImportInvalidError("add an application column: the application each row belongs to", [{ row: 1, column: "application", message: "no application column" }]);
  }
  return { kind: kind as ImportKind, existing, csvRows, records, invalid };
}

// ---------------------------------------------------------------- planning


function fileAuthority(connectionId: string | null): SourceAuthority {
  return { sourceId: connectionId ?? "file-imports", priority: FILE_IMPORT_PRIORITY, authoritativeFields: [...SOURCED_IDENTITY_FIELDS] };
}

type IdentityPlan = { rows: ImportPlanRow[]; ops: SourcedOp[]; normalized: Map<string, ImportedIdentity>; matcher: ReturnType<typeof identityMatcher> };

/** Which identity each record is (Integration's decision, as for identity sources), as create and update operations. */
async function planIdentities(tenantId: string, records: ImportRecord[], scope: string | null): Promise<IdentityPlan> {
  const candidates = await listIdentitiesForCorrelation(tenantId, [...MANUAL_IDENTITY_TYPES]);
  const typeOf = new Map(candidates.map((c) => [c.id, c.identityType]));
  const matcher = identityMatcher(candidates);
  const fallbackType = defaultIdentityType(scope);
  const rows: ImportPlanRow[] = [];
  const ops: SourcedOp[] = [];
  const normalized = new Map<string, ImportedIdentity>();
  for (const r of records) {
    const n = normalizeImportedIdentity(r.values);
    if ("invalid" in n) {
      rows.push(invalidRow(r, n.invalid));
      continue;
    }
    const m = matcher.match(n.externalId, n.fields);
    if (m.kind === "review") {
      rows.push({ row: r.row, externalId: r.externalId, decision: "review", targetId: null, changes: [], note: m.reason });
      continue;
    }
    if (m.kind === "new") {
      if (!n.fields.displayName) {
        rows.push(invalidRow(r, "no displayName (a new identity needs a name)"));
        continue;
      }
      ops.push({ op: "create", ref: r.externalId, identityType: n.identityType ?? fallbackType, fields: n.fields, nativeId: n.externalId });
    } else {
      ops.push({ op: "update", ref: r.externalId, identityId: m.identityId, fields: n.fields });
      const current = typeOf.get(m.identityId) as IdentityType | undefined;
      if (n.identityType && current && n.identityType !== current) rows.push({ row: r.row, externalId: r.externalId, decision: "update", targetId: m.identityId, changes: [], note: `stays ${current.toLowerCase()}` });
    }
    normalized.set(r.externalId, n);
  }
  return { rows, ops, normalized, matcher };
}

async function previewRecords(ctx: TenantContext, kind: ImportKind, records: ImportRecord[], scope: string | null, connectionId: string | null): Promise<ImportPlanRow[]> {
  const tenantId = ctx.tenantId!;
  if (kind !== "identity") return previewAccessImport(tenantId, kind as AccessImportKind, records, { integrationId: connectionId });

  const plan = await planIdentities(tenantId, records, scope);
  const notes = new Map(plan.rows.filter((r) => r.decision === "update").map((r) => [r.externalId, r.note]));
  const preview = await previewSourcedIdentities(tenantId, fileAuthority(connectionId), plan.ops);
  const fileRefs = new Set(records.map((r) => r.externalId));
  const rowOf = new Map(records.map((r) => [r.externalId, r.row]));
  const out: ImportPlanRow[] = plan.rows.filter((r) => r.decision !== "update");
  for (const p of preview) {
    const n = plan.normalized.get(p.ref);
    const extra: string[] = [];
    const typeNote = notes.get(p.ref);
    if (typeNote) extra.push(typeNote);
    if (p.skipped.length) extra.push(`kept by a source of record: ${p.skipped.map((s) => s.field).join(", ")}`);
    if (n?.managerExternalId && !fileRefs.has(n.managerExternalId) && !plan.matcher.resolveManager(n.managerExternalId)) extra.push(`manager "${n.managerExternalId.slice(0, 80)}" not found; left as is`);
    const decision = p.action === "create" ? "new" : p.action === "update" ? "update" : p.action === "unchanged" ? "unchanged" : "invalid";
    out.push({ row: rowOf.get(p.ref) ?? null, externalId: p.ref, decision, targetId: p.identityId, changes: p.changes, note: p.error ?? (extra.join("; ") || null) });
  }
  return out;
}

// ---------------------------------------------------------------- preview

/** The page's columns, in order, shown in the preview when the file fills them. */
const PREVIEW_COLUMNS: Record<ImportKind, string[]> = {
  identity: [
    "externalId",
    "displayName",
    "email",
    "username",
    "identityType",
    "title",
    "department",
    "businessUnit",
    "location",
    "employmentType",
    "organization",
    "managerExternalId",
    "startDate",
    "endDate",
    "status",
  ],
  application: ["externalId", "name", "category", "description"],
  entitlement: ["externalId", "name", "application", "privilegeLevel", "dataClassification"],
  account: ["externalId", "application", "username", "owner", "status", "accountType", "lastLoginAt"],
  access_grant: ["accountExternalId", "entitlementExternalId", "grantType"],
};

/** Rows sent with a preview; the counts always cover the whole file. */
export const PREVIEW_ROWS = 500;

export type ImportPreviewRow = ImportPlanRow & { values: Record<string, string> };
export type FileImportPreview = { kind: ImportKind; rows: number; counts: ImportCounts; columns: string[]; shown: ImportPreviewRow[] };

const display = (v: unknown): string => (v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

export async function previewFileForObject(ctx: TenantContext, kind: string, scope: string | null, csvText: string): Promise<FileImportPreview> {
  const tenantId = ctx.tenantId;
  if (!tenantId) throw new ApiError(403, "NO_TENANT", "Choose an organization first");
  const file = await readImport(tenantId, kind, csvText);
  const planned = await previewRecords(ctx, file.kind, file.records, scope, file.existing?.id ?? null);
  const rows = [...file.invalid, ...planned].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  const values = new Map(file.records.map((r) => [r.externalId, r.values]));

  // Problems first when the file is longer than the preview, so none is hidden.
  const problems = rows.filter((r) => r.decision === "invalid" || r.decision === "review");
  const picked = new Set(problems.slice(0, PREVIEW_ROWS));
  for (const r of rows) if (picked.size < PREVIEW_ROWS) picked.add(r);
  const columns = PREVIEW_COLUMNS[file.kind].filter((c) => file.records.some((r) => display(r.values[c]) !== ""));
  const shown = rows
    .filter((r) => picked.has(r))
    .map((r) => {
      const v = values.get(r.externalId) ?? {};
      return { ...r, values: Object.fromEntries(columns.map((c) => [c, display(v[c])])) };
    });
  return { kind: file.kind, rows: rows.length, counts: countDecisions(rows), columns, shown };
}

// ---------------------------------------------------------------- import

export type FileImportResult = {
  jobId: string;
  integrationId: string;
  fileId: string;
  rows: number;
  counts: ImportOutcomeCounts;
  /** Rows not added or updated, with the reason; at most 50. */
  problems: { row: number | null; externalId: string; message: string }[];
};

/** What the File imports connection stored from this job's file: records for the owning module. */
async function storedRecords(tenantId: string, integrationId: string, kind: ImportKind, jobId: string): Promise<ImportRecord[]> {
  const supabase = supabaseServiceRole();
  const out: ImportRecord[] = [];
  for (let from = 0; from < PAGE_IMPORT_MAX_ROWS + 1000; from += 1000) {
    const { data, error } = await supabase
      .from("integration_objects")
      .select("external_id, raw, normalized")
      .eq("tenant_id", tenantId)
      .eq("integration_id", integrationId)
      .eq("object_type", kind)
      .eq("sync_job_id", jobId)
      .order("external_id")
      .range(from, from + 999);
    if (error) throw new ApiError(500, "QUERY_FAILED", "The imported records could not be read");
    for (const o of data ?? []) {
      const raw = (o.raw ?? {}) as Record<string, unknown>;
      out.push({ row: typeof raw._row === "number" ? raw._row : null, externalId: o.external_id as string, values: (o.normalized ?? {}) as Record<string, unknown> });
    }
    if (!data || data.length < 1000) break;
  }
  return out.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
}

async function applyIdentities(tenantId: string, records: ImportRecord[], scope: string | null, connectionId: string, jobId: string): Promise<ImportApplyRow[]> {
  const plan = await planIdentities(tenantId, records, scope);
  const authority = { ...fileAuthority(connectionId), sourceName: FILE_IMPORTS_NAME, runId: jobId };
  const rowOf = new Map(records.map((r) => [r.externalId, r.row]));
  const out: ImportApplyRow[] = plan.rows
    .filter((r) => r.decision === "invalid" || r.decision === "review")
    .map((r) => ({ row: r.row, externalId: r.externalId, outcome: "skipped", targetId: null, message: r.note }));
  const idByRef = new Map<string, string>();
  const results = new Map<string, ImportApplyRow>();
  for (let i = 0; i < plan.ops.length; i += 500) {
    for (const r of await applySourcedIdentities(tenantId, authority, plan.ops.slice(i, i + 500))) {
      if (r.identityId && r.action !== "error") idByRef.set(r.ref, r.identityId);
      const outcome = r.action === "created" ? "created" : r.action === "updated" ? "updated" : r.action === "unchanged" ? "unchanged" : "failed";
      results.set(r.ref, { row: rowOf.get(r.ref) ?? null, externalId: r.ref, outcome, targetId: r.identityId, message: r.error ?? r.lifecycleError ?? null });
    }
  }
  // Managers once every record has an identity: one in this file, or an existing one.
  const managerOps: SourcedOp[] = [];
  for (const [ref, n] of plan.normalized) {
    const self = idByRef.get(ref);
    if (!self || !n.managerExternalId) continue;
    const manager = idByRef.get(n.managerExternalId) ?? plan.matcher.resolveManager(n.managerExternalId);
    if (manager && manager !== self) managerOps.push({ op: "update", ref, identityId: self, fields: { managerIdentityId: manager } });
  }
  for (let i = 0; i < managerOps.length; i += 500) {
    for (const r of await applySourcedIdentities(tenantId, authority, managerOps.slice(i, i + 500))) {
      const result = results.get(r.ref);
      if (!result) continue;
      if (r.action === "error") result.message = `manager not set: ${r.error}`;
      else if (r.action === "updated" && result.outcome === "unchanged") result.outcome = "updated";
    }
  }
  return [...out, ...results.values()];
}

export async function importFileForObject(ctx: TenantContext, kind: string, scope: string | null, filename: string | null, csvText: string): Promise<FileImportResult> {
  const tenantId = ctx.tenantId;
  if (!tenantId) throw new ApiError(403, "NO_TENANT", "Choose an organization first");
  const file = await readImport(tenantId, kind, csvText);

  const connection = file.existing ?? (await fileImportsConnection(tenantId, ctx.userId));
  const stored = await storeConnectorFile(tenantId, connection.id, {
    kind: file.kind,
    filename: uploadFilename(filename),
    content: csvText,
    rowCount: file.csvRows.length,
    createdBy: ctx.userId,
  });
  const job = await createSyncJob(tenantId, connection.id, "manual");
  await writeAudit({
    tenantId,
    actorId: ctx.userId,
    actorType: "user",
    action: "integration.file_imported",
    objectType: "integration",
    objectId: connection.id,
    outcome: "success",
    // Counts and a digest, never row contents.
    metadata: { kind: file.kind, rows: file.csvRows.length, bytes: stored.byteSize, sha256: stored.sha256, fileId: stored.id, jobId: job.id },
  });

  // The connection reads and stores the file (the framework's sync), then the owning module applies what it stored.
  await runSyncJob(tenantId, job.id);
  const { data: jobRow } = await supabaseServiceRole()
    .from("integration_sync_jobs")
    .select("status, errors")
    .eq("tenant_id", tenantId)
    .eq("id", job.id)
    .maybeSingle<{ status: string; errors: { message?: string }[] | null }>();
  if (!jobRow || jobRow.status === "failed" || jobRow.status === "running" || jobRow.status === "queued") {
    const reason = jobRow?.errors?.[0]?.message;
    throw new ApiError(502, "SYNC_FAILED", `The File imports connection could not read the file${reason ? `: ${reason.slice(0, 200)}` : ""}. Nothing was added.`);
  }

  const records = await storedRecords(tenantId, connection.id, file.kind, job.id);
  const applied =
    file.kind === "identity"
      ? await applyIdentities(tenantId, records, scope, connection.id, job.id)
      : await applyAccessImport(tenantId, ctx.userId, file.kind as AccessImportKind, records, { integrationId: connection.id, jobId: job.id });
  // Rows the mapping refused were never stored; they are reported with the rest.
  const all: ImportApplyRow[] = [
    ...file.invalid.map((r): ImportApplyRow => ({ row: r.row, externalId: r.externalId, outcome: "skipped", targetId: null, message: r.note })),
    ...applied,
  ].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

  const counts: ImportOutcomeCounts = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const r of all) counts[r.outcome]++;
  await writeAudit({
    tenantId,
    actorId: ctx.userId,
    actorType: "user",
    action: "integration.file_applied",
    objectType: "integration",
    objectId: connection.id,
    outcome: counts.failed ? "failure" : "success",
    correlationId: job.id,
    metadata: { kind: file.kind, jobId: job.id, fileId: stored.id, ...counts },
  });
  const problems = all
    .filter((r) => r.outcome === "skipped" || r.outcome === "failed")
    .slice(0, 50)
    .map((r) => ({ row: r.row, externalId: r.externalId, message: r.message ?? r.outcome }));
  return { jobId: job.id, integrationId: connection.id, fileId: stored.id, rows: file.csvRows.length, counts, problems };
}
