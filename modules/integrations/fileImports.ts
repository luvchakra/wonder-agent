import "server-only";

import { after } from "next/server";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";
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
  INLINE_SYNC_MAX_ROWS,
  MAX_IMPORT_BYTES,
  isImportKind,
  IMPORT_KINDS,
} from "./fileImportRules";

/**
 * Importing a CSV from an object page, through the connector framework
 * (non-negotiable #20): the file is an upload of the tenant's single "File
 * imports" connection (built-in csv-file), and that connection's sync reads
 * it, maps it with the definition and stores it in integration_objects,
 * like any other connector. There is no second import path.
 *
 * The caller has checked integration.execute (the permission that runs a
 * sync); `ctx.tenantId` is the server-resolved tenant (§14).
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

export type FileImportResult = {
  jobId: string;
  integrationId: string;
  fileId: string;
  rows: number;
  /** `completed`: the sync ran before this returned (its job holds the outcome); `running`: it runs in the background. */
  sync: "completed" | "running";
};

export async function importFileForObject(ctx: TenantContext, kind: string, filename: string | null, csvText: string): Promise<FileImportResult> {
  const tenantId = ctx.tenantId;
  if (!tenantId) throw new ApiError(403, "NO_TENANT", "Choose an organization first");
  if (!isImportKind(kind)) throw new FileImportInvalidError(`kind: one of ${IMPORT_KINDS.join(", ")}`);
  if (Buffer.byteLength(csvText, "utf8") > MAX_IMPORT_BYTES) throw new FileImportInvalidError(`file: larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB`);

  // Checked against the connection's own settings (its column renames), before anything is stored.
  const existing = await findFileImportsConnection(tenantId);
  if (existing?.status === "disabled") throw new ApiError(409, "CONNECTION_DISABLED", "The File imports connection is disabled");
  const { def, settings } = existing ? parseConnectorConfig(existing.config) : { def: CSV_FILE(), settings: {} };
  const target = uploadTarget(def, settings, kind);
  if ("status" in target) throw target.status === 409 ? new ApiError(409, "CONFLICT", target.message) : new FileImportInvalidError(target.message);
  const { records, issues } = readCsvFile(target.kind, target.spec, csvText, fileColumns(target.spec, settings));
  if (issues.length) throw new FileImportInvalidError(issues[0].message, issues.slice(0, 20));
  if (records.length === 0) throw new FileImportInvalidError("the file has a header row but no records", [{ row: 2, message: "no records" }]);

  const connection = existing ?? (await fileImportsConnection(tenantId, ctx.userId));
  const stored = await storeConnectorFile(tenantId, connection.id, {
    kind: target.kind,
    filename: uploadFilename(filename),
    content: csvText,
    rowCount: records.length,
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
    metadata: { kind: target.kind, rows: records.length, bytes: stored.byteSize, sha256: stored.sha256, fileId: stored.id, jobId: job.id },
  });

  const inline = records.length <= INLINE_SYNC_MAX_ROWS;
  if (inline) await runSyncJob(tenantId, job.id);
  else after(() => runSyncJob(tenantId, job.id));
  return { jobId: job.id, integrationId: connection.id, fileId: stored.id, rows: records.length, sync: inline ? "completed" : "running" };
}
