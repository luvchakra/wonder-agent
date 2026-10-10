import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";
import { buildNhiInventory } from "@/modules/agent-identity/service";
import { getMcpInventory } from "@/modules/integrations/service";
import { CSV_BOM, csvRow, exportFilename } from "./csvWriter";
import {
  EXPORT_CHUNK_SIZE,
  EXPORT_ROW_CAP,
  importColumns,
  isTableSource,
  type ExportColumn,
  type ExportEntry,
  type ServiceSource,
  type TableSource,
} from "./exportRegistry";

/**
 * Object-page CSV export (2026-10-10). Streams one registry entry's rows
 * for the caller's tenant. The caller (the route) has already checked the
 * page's read permission and `report.export` on the server-resolved tenant
 * context; nothing here takes a tenant id from the request.
 *
 * Reads run as the signed-in user (`supabaseServer()`), so RLS applies,
 * and every query also filters `tenant_id` explicitly (CLAUDE.md §14).
 * Rows are paged at the database 1,000 at a time and stop at
 * EXPORT_ROW_CAP; a truncated file says so in its last line and in the
 * `X-Export-Row-Cap` header. Every finished or failed export writes an
 * audit event `<module>.exported` with the row count (non-negotiable #11).
 */

type Row = Record<string, unknown>;
type Db = Awaited<ReturnType<typeof supabaseServer>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_BATCH = 200;

function csvHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Export-Row-Cap": String(EXPORT_ROW_CAP),
  };
}

/** The import template: just the canonical header row. */
export function templateResponse(entry: ExportEntry): Response {
  if (!entry.importKind) throw new ApiError(404, "NOT_FOUND", "This object has no import template");
  const { required, optional } = importColumns(entry.importKind);
  const body = CSV_BOM + csvRow([...required, ...optional]);
  return new Response(body, { headers: csvHeaders(`${entry.key}-template.csv`) });
}

function selectList(columns: readonly ExportColumn[]): string {
  const fields = new Set<string>(["id"]);
  for (const c of columns) {
    fields.add(c.field);
    if (c.fallback) fields.add(c.fallback);
  }
  return [...fields].join(",");
}

/** Resolve lookup labels for one chunk, by id, inside the tenant. Cached across chunks. */
async function resolveLookups(db: Db, tenantId: string, columns: readonly ExportColumn[], rows: Row[], cache: Map<string, Map<string, string>>): Promise<void> {
  for (const c of columns) {
    if (!c.lookup) continue;
    const key = `${c.lookup.table}.${c.lookup.label}`;
    const known = cache.get(key) ?? new Map<string, string>();
    cache.set(key, known);
    const wanted = [...new Set(rows.map((r) => r[c.field]).filter((v): v is string => typeof v === "string" && UUID.test(v) && !known.has(v)))];
    for (let i = 0; i < wanted.length; i += LOOKUP_BATCH) {
      const ids = wanted.slice(i, i + LOOKUP_BATCH);
      const { data, error } = await db.from(c.lookup.table).select(`id,${c.lookup.label}`).eq("tenant_id", tenantId).in("id", ids);
      if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
      for (const r of (data ?? []) as unknown as Row[]) {
        const label = r[c.lookup.label];
        known.set(String(r.id), label === null || label === undefined || label === "" ? (c.lookup.fallbackToId ? String(r.id) : "") : String(label));
      }
    }
  }
}

function cellValue(row: Row, c: ExportColumn, cache: Map<string, Map<string, string>>): unknown {
  const raw = row[c.field];
  if (c.lookup) {
    if (typeof raw !== "string") return raw ?? null;
    return cache.get(`${c.lookup.table}.${c.lookup.label}`)?.get(raw) ?? (c.lookup.fallbackToId ? raw : "");
  }
  if ((raw === null || raw === undefined || raw === "") && c.fallback) return row[c.fallback];
  return raw;
}

function tableQuery(db: Db, tenantId: string, source: TableSource, select: string, params: URLSearchParams) {
  let q = db.from(source.table).select(select);
  // Explicit tenant filter on top of RLS. A built-in (tenant_id null) row is
  // only included where the page lists them; the tenant id is the server-
  // resolved uuid, never request text.
  if (source.includeGlobal) {
    if (!UUID.test(tenantId)) throw new ApiError(400, "INVALID_TENANT", "Invalid tenant");
    q = q.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  } else {
    q = q.eq("tenant_id", tenantId);
  }
  for (const w of source.where ?? []) q = q.in(w.column, [...w.in]);
  for (const c of source.whereNull ?? []) q = q.is(c, null);
  for (const f of source.params ?? []) {
    const v = params.get(f.param);
    if (v && f.allowed.includes(v)) q = q.eq(f.column, v);
  }
  if (source.orderBy) q = q.order(source.orderBy.column, { ascending: source.orderBy.ascending, nullsFirst: false });
  return q.order("id", { ascending: true });
}

async function* tableRows(db: Db, tenantId: string, entry: ExportEntry, source: TableSource, params: URLSearchParams): AsyncGenerator<Row[], { truncated: boolean }> {
  const select = selectList(entry.columns);
  const cache = new Map<string, Map<string, string>>();
  for (let offset = 0; offset < EXPORT_ROW_CAP; offset += EXPORT_CHUNK_SIZE) {
    const end = Math.min(offset + EXPORT_CHUNK_SIZE, EXPORT_ROW_CAP) - 1;
    const { data, error } = await tableQuery(db, tenantId, source, select, params).range(offset, end);
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length) {
      await resolveLookups(db, tenantId, entry.columns, rows, cache);
      yield rows.map((r) => Object.fromEntries(entry.columns.map((c) => [c.header, cellValue(r, c, cache)])));
    }
    if (rows.length < end - offset + 1) return { truncated: false };
  }
  // Exactly at the cap: one probe row says whether anything was left out.
  const probe = await tableQuery(db, tenantId, source, "id", params).range(EXPORT_ROW_CAP, EXPORT_ROW_CAP);
  if (probe.error) throw new ApiError(500, "QUERY_FAILED", probe.error.message);
  return { truncated: (probe.data ?? []).length > 0 };
}

/** Lists the owning modules compute (their published services, user-scoped reads). */
async function serviceRows(tenantId: string, source: ServiceSource): Promise<Row[]> {
  if (source.service === "nhi_inventory") {
    const entries = await buildNhiInventory(tenantId);
    return entries.map((e) => ({ ...e, agentName: e.agent?.name ?? null }));
  }
  const servers = await getMcpInventory(tenantId);
  return servers.map((s) => ({ ...s, toolCount: s.tools.length, resourceCount: s.resources.length }));
}

async function* serviceChunks(tenantId: string, entry: ExportEntry, source: ServiceSource): AsyncGenerator<Row[], { truncated: boolean }> {
  const all = await serviceRows(tenantId, source);
  const kept = all.slice(0, EXPORT_ROW_CAP);
  for (let i = 0; i < kept.length; i += EXPORT_CHUNK_SIZE) {
    yield kept.slice(i, i + EXPORT_CHUNK_SIZE).map((r) => Object.fromEntries(entry.columns.map((c) => [c.header, r[c.field] ?? (c.fallback ? r[c.fallback] : null)])));
  }
  return { truncated: all.length > EXPORT_ROW_CAP };
}

export async function exportResponse(ctx: TenantContext, entry: ExportEntry, params: URLSearchParams): Promise<Response> {
  const tenantId = ctx.tenantId;
  if (!tenantId) throw new ApiError(401, "NO_TENANT", "No active tenant membership");
  // Resolve the request-scoped client now: the stream below runs after the
  // handler has returned, outside the request's cookie scope.
  const db = await supabaseServer();
  const source = entry.source;
  const filters = isTableSource(source)
    ? Object.fromEntries((source.params ?? []).flatMap((f) => (params.get(f.param) && f.allowed.includes(params.get(f.param)!) ? [[f.param, params.get(f.param)]] : [])))
    : {};
  const chunks = isTableSource(source) ? tableRows(db, tenantId, entry, source, params) : serviceChunks(tenantId, entry, source);
  const headers = entry.columns.map((c) => c.header);
  const encoder = new TextEncoder();
  let rows = 0;
  let started = false;
  let finished = false;

  const audit = (outcome: "success" | "failure", extra: Record<string, unknown>) =>
    writeAudit({
      tenantId,
      actorId: ctx.userId,
      actorType: "user",
      action: `${entry.auditModule}.exported`,
      objectType: "export",
      objectId: entry.key,
      outcome,
      metadata: { object: entry.key, format: "csv", rows, filters, ...extra },
    });

  // The first page is read before the response starts, so a failing query
  // returns a real error status instead of a 200 with a cut-off file.
  let pending: IteratorResult<Row[], { truncated: boolean }> | null;
  try {
    pending = await chunks.next();
  } catch (err) {
    finished = true;
    await audit("failure", { error: err instanceof ApiError ? err.code : "EXPORT_FAILED" });
    throw err;
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(CSV_BOM + csvRow(headers)));
          return;
        }
        const next = pending ?? (await chunks.next());
        pending = null;
        if (!next.done) {
          rows += next.value.length;
          controller.enqueue(encoder.encode(next.value.map((r) => csvRow(headers.map((h) => r[h]))).join("")));
          return;
        }
        const { truncated } = next.value;
        if (truncated) {
          controller.enqueue(encoder.encode(csvRow([`Export stopped at ${EXPORT_ROW_CAP.toLocaleString("en-US")} rows; more exist. Narrow the list and export again.`])));
        }
        finished = true;
        await audit("success", { truncated });
        controller.close();
      } catch (err) {
        finished = true;
        await audit("failure", { error: err instanceof ApiError ? err.code : "EXPORT_FAILED" });
        controller.error(err);
      }
    },
    async cancel() {
      if (!finished) {
        finished = true;
        await audit("failure", { error: "CANCELLED" });
      }
    },
  });

  return new Response(stream, { headers: csvHeaders(exportFilename(entry.key)) });
}
