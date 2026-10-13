import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";

/**
 * Owner request (2026-10-13): an environment's page in the platform console
 * shows what is in it and how busy it is. Counts only, never records: each
 * query is scoped to the one tenant passed in (§14), with the service role
 * the console already uses after requirePlatformAdmin(). A count that cannot
 * be read is null and shown as unavailable, never as zero (§19.2).
 */
export type EnvironmentStats = {
  users: number | null;
  identities: number | null;
  applications: number | null;
  accounts: number | null;
  agents: number | null;
  connections: number | null;
  accessRequests: number | null;
  findings: number | null;
  runtimeEvents30d: number | null;
  lastActivityAt: string | null;
};

const DAY = 24 * 60 * 60 * 1000;

export async function getEnvironmentStats(tenantId: string, now = new Date()): Promise<EnvironmentStats> {
  const supabase = supabaseServiceRole();
  const count = async (table: string, filter: { eq?: [string, string]; gte?: [string, string] } = {}): Promise<number | null> => {
    let q = supabase.from(table).select("tenant_id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (filter.eq) q = q.eq(...filter.eq);
    if (filter.gte) q = q.gte(...filter.gte);
    const { count: n, error } = await q;
    return error ? null : (n ?? 0);
  };
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  const [users, identities, applications, accounts, agents, connections, accessRequests, findings, runtimeEvents30d, last] = await Promise.all([
    count("tenant_memberships", { eq: ["status", "active"] }),
    count("identities"),
    count("applications"),
    count("accounts"),
    count("agents"),
    count("integrations"),
    count("access_requests"),
    count("risk_findings"),
    count("runtime_events", { gte: ["event_time", since] }),
    supabase.from("audit_logs").select("created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    users,
    identities,
    applications,
    accounts,
    agents,
    connections,
    accessRequests,
    findings,
    runtimeEvents30d,
    lastActivityAt: last.error ? null : ((last.data?.created_at as string | undefined) ?? null),
  };
}
