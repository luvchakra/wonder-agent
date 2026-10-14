import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { removalOutcome, slaOutcome, type RemovalOutcome, type SlaOutcome } from "./controlEvidenceRules";

/**
 * COMPLIANCE-P0-14 part 2 — Access's published reads for control evidence:
 * what became of removal requests (closed-loop revocation), and whether a
 * leaver's removals were done within their due date. Service role; every
 * query is filtered on `tenantId` and each row's tenant is checked (§14).
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RemovalStatus = { outcome: RemovalOutcome; dueAt: string | null; verifiedAt: string | null };

export async function removalOutcomes(tenantId: string, requestIds: string[]): Promise<Map<string, RemovalStatus>> {
  const ids = [...new Set(requestIds.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, RemovalStatus>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const admin = supabaseServiceRole();
    const [grants, tasks] = await Promise.all([
      admin.from("access_grants").select("tenant_id, removal_request_id, revoked_at, removal_status").eq("tenant_id", tenantId).in("removal_request_id", chunk),
      admin.from("access_fulfilment_tasks").select("tenant_id, request_id, status, due_at").eq("tenant_id", tenantId).in("request_id", chunk).neq("status", "cancelled"),
    ]);
    if (grants.error) throw new ApiError(500, "QUERY_FAILED", grants.error.message);
    if (tasks.error) throw new ApiError(500, "QUERY_FAILED", tasks.error.message);
    for (const id of chunk) {
      const g = ((grants.data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId && r.removal_request_id === id);
      const t = ((tasks.data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId && r.request_id === id);
      const outcome = removalOutcome(
        g.map((r) => ({ revokedAt: (r.revoked_at as string | null) ?? null, removalStatus: (r.removal_status as string | null) ?? null })),
        t.map((r) => ({ status: r.status as string })),
      );
      const revoked = g.map((r) => r.revoked_at as string | null).filter((x): x is string => Boolean(x)).sort();
      out.set(id, { outcome, dueAt: (t.map((r) => r.due_at as string).sort()[0] ?? null), verifiedAt: outcome === "verified" ? (revoked[revoked.length - 1] ?? null) : null });
    }
  }
  return out;
}

export type LeaverRemovalRow = {
  taskId: string;
  identityId: string | null;
  applicationId: string;
  applicationName: string;
  kind: "remove" | "disable_account";
  openedAt: string;
  dueAt: string;
  doneAt: string | null;
  outcome: SlaOutcome;
};

/** A leaver's removal and disable tasks opened in the last `days` days, each against its due date. */
export async function leaverRemovalTasks(tenantId: string, days: number, now = new Date()): Promise<LeaverRemovalRow[]> {
  const since = new Date(now.getTime() - Math.min(Math.max(days, 1), 366) * 86_400_000).toISOString();
  const admin = supabaseServiceRole();
  const { data: tasks, error } = await admin
    .from("access_fulfilment_tasks")
    .select("id, tenant_id, kind, status, due_at, completed_at, closed_at, created_at, removal_grant_id, account_id, application_id, applications(name, display_name)")
    .eq("tenant_id", tenantId)
    .eq("reason", "leaver")
    .in("kind", ["remove", "disable_account"])
    .neq("status", "cancelled")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const own = ((tasks ?? []) as Row[]).filter((t) => t.tenant_id === tenantId);
  // Whose: the account the task is on (directly, or through the grant it removes).
  const grantIds = own.map((t) => t.removal_grant_id as string | null).filter((x): x is string => Boolean(x));
  const grantAccount = new Map<string, string>();
  for (let i = 0; i < grantIds.length; i += 500) {
    const { data, error: gErr } = await admin.from("access_grants").select("id, tenant_id, account_id").eq("tenant_id", tenantId).in("id", grantIds.slice(i, i + 500));
    if (gErr) throw new ApiError(500, "QUERY_FAILED", gErr.message);
    for (const g of (data ?? []) as Row[]) if (g.tenant_id === tenantId && g.account_id) grantAccount.set(g.id as string, g.account_id as string);
  }
  const accountIds = [...new Set([...own.map((t) => t.account_id as string | null).filter((x): x is string => Boolean(x)), ...grantAccount.values()])];
  const accountIdentity = new Map<string, string | null>();
  for (let i = 0; i < accountIds.length; i += 500) {
    const { data, error: aErr } = await admin.from("accounts").select("id, tenant_id, identity_id").eq("tenant_id", tenantId).in("id", accountIds.slice(i, i + 500));
    if (aErr) throw new ApiError(500, "QUERY_FAILED", aErr.message);
    for (const a of (data ?? []) as Row[]) if (a.tenant_id === tenantId) accountIdentity.set(a.id as string, (a.identity_id as string | null) ?? null);
  }
  return own.map((t) => {
    const account = (t.account_id as string | null) ?? (t.removal_grant_id ? (grantAccount.get(t.removal_grant_id as string) ?? null) : null);
    const app = t.applications as { name?: string; display_name?: string | null } | null;
    const doneAt = (t.completed_at as string | null) ?? (t.status === "verified" ? ((t.closed_at as string | null) ?? null) : null);
    return {
      taskId: t.id as string,
      identityId: account ? (accountIdentity.get(account) ?? null) : null,
      applicationId: t.application_id as string,
      applicationName: app?.display_name ?? app?.name ?? "",
      kind: t.kind as "remove" | "disable_account",
      openedAt: t.created_at as string,
      dueAt: t.due_at as string,
      doneAt,
      outcome: slaOutcome({ status: t.status as string, dueAt: t.due_at as string, doneAt }, now),
    };
  });
}
