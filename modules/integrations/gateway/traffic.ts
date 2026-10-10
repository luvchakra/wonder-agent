import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * Reading the Connector Gateway's ledger (connector_traffic, migration
 * 0110). Reads run as the signed-in user, so RLS applies on top of the
 * explicit tenant filter; totals are computed and paged in the database
 * (connector_traffic_summary), never in the browser (§15).
 */

export type ConnectionTraffic = {
  /** Null for previews of unsaved definitions. */
  integrationId: string | null;
  integrationName: string | null;
  requests: number;
  errors: number;
  blocked: number;
  bytesIn: number;
  bytesOut: number;
  avgDurationMs: number | null;
  lastAt: string | null;
};

type SummaryRow = {
  integration_id: string | null;
  integration_name: string | null;
  requests: number | string;
  errors: number | string;
  blocked: number | string;
  bytes_in: number | string;
  bytes_out: number | string;
  avg_duration_ms: number | string | null;
  last_at: string | null;
  total_count: number | string;
};

export const TRAFFIC_PAGE_SIZE = 25;

/** Traffic per connection since `since`, busiest first, one page at a time. */
export async function listConnectorTraffic(
  tenantId: string,
  opts: { since: Date; integrationId?: string; page?: number; pageSize?: number },
): Promise<{ rows: ConnectionTraffic[]; total: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? TRAFFIC_PAGE_SIZE, 1), 200);
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("connector_traffic_summary", {
    p_tenant_id: tenantId,
    p_since: opts.since.toISOString(),
    p_integration_id: opts.integrationId ?? null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw new ApiError(500, "QUERY_FAILED", "Traffic could not be read");
  const rows = (data ?? []) as SummaryRow[];
  return {
    total: rows.length ? Number(rows[0].total_count) : 0,
    rows: rows.map((r) => ({
      integrationId: r.integration_id,
      integrationName: r.integration_name,
      requests: Number(r.requests),
      errors: Number(r.errors),
      blocked: Number(r.blocked),
      bytesIn: Number(r.bytes_in),
      bytesOut: Number(r.bytes_out),
      avgDurationMs: r.avg_duration_ms === null ? null : Number(r.avg_duration_ms),
      lastAt: r.last_at,
    })),
  };
}

/** Retention: removes ledger rows older than 30 days, for every organization. Called by the daily cron. */
export async function purgeConnectorTraffic(): Promise<number> {
  const { data, error } = await supabaseServiceRole().rpc("purge_connector_traffic", {});
  if (error) throw new ApiError(500, "PURGE_FAILED", "Connector traffic could not be purged");
  return Number(data ?? 0);
}
