import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AuditLogEntry, AuditLogFilter, AuditLogPage } from "@/lib/shared/types/operations";
import { toAuditLogEntry } from "./mappers";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * OPERATIONS-P0-01.1. Read/query/presentation only over Foundation's
 * `audit_logs` — `writeAudit()` (lib/audit/writeAudit.ts) remains the only
 * writer (FOUNDATION-P0-05.1); this module never inserts into
 * `audit_logs` itself. `audit_logs` grants client SELECT scoped by RLS to
 * `current_tenant_ids()` (migration 0005) — runs as the calling user via
 * `supabaseServer()`, with `audit.read` gating access at the app layer
 * (RLS's job here is only tenant isolation, same division of labor as
 * every other module's read path). Keyset-paginated on `created_at` per
 * CLAUDE.md §15 — never a full-table fetch.
 */
export async function listAuditLogs(
  tenantId: string,
  filter: AuditLogFilter = {},
  cursor: string | null = null,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<AuditLogPage> {
  const supabase = await supabaseServer();
  const limit = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);

  let query = supabase.from("audit_logs").select().eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit + 1);
  if (filter.objectType) query = query.eq("object_type", filter.objectType);
  if (filter.action) query = query.eq("action", filter.action);
  if (filter.actorId) query = query.eq("actor_id", filter.actorId);
  if (filter.from) query = query.gte("created_at", filter.from);
  if (filter.to) query = query.lte("created_at", filter.to);
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const entries = page.map(toAuditLogEntry);
  return { entries, nextCursor: hasMore ? entries[entries.length - 1]!.createdAt : null };
}

/**
 * OPERATIONS-P0-01.2. Same tenant scoping/filters as `listAuditLogs()`,
 * capped at a hard maximum row count for a single export (`report.export`
 * gates the caller at the API-route layer, same as every other export
 * path in this codebase) — a genuinely unbounded export is a P1 concern
 * (scheduled/background export), not this story's.
 */
const EXPORT_MAX_ROWS = 5000;

export async function exportAuditLogs(tenantId: string, filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("audit_logs").select().eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(EXPORT_MAX_ROWS);
  if (filter.objectType) query = query.eq("object_type", filter.objectType);
  if (filter.action) query = query.eq("action", filter.action);
  if (filter.actorId) query = query.eq("actor_id", filter.actorId);
  if (filter.from) query = query.gte("created_at", filter.from);
  if (filter.to) query = query.lte("created_at", filter.to);

  const { data, error } = await query;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAuditLogEntry);
}
