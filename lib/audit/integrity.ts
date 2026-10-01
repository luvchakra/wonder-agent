import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * FOUNDATION-P0-29 — verification of a tenant's tamper-evident audit trail
 * (migration 0104). `verify_audit_chain()` walks the per-tenant hash chain
 * in the database and reports the first break: a changed row, a removed
 * row or a reordered one. Service-role RPC, always with the caller's own
 * server-resolved tenant (§14); the caller has passed audit.read.
 *
 * Evidence for SOX ITGC CO-01, PCI DSS 10.3.2 and ISO 27001 A.8.15: the
 * verification itself is recorded in the audit trail it verified.
 */

export type AuditChainReport = {
  verifiedAt: string;
  checked: number;
  firstSeq: number | null;
  lastSeq: number | null;
  intact: boolean;
  brokenAtSeq: number | null;
  reason: string | null;
  purges: { upToSeq: number; purgedCount: number; purgedBefore: string; purgedAt: string }[];
};

export async function verifyAuditChain(tenantId: string, actorId: string): Promise<AuditChainReport> {
  const supabase = supabaseServiceRole();
  const [{ data, error }, { data: purges }] = await Promise.all([
    supabase.rpc("verify_audit_chain", { p_tenant: tenantId }),
    supabase.from("audit_log_purges").select("up_to_seq, purged_count, purged_before, purged_at").eq("tenant_id", tenantId).order("up_to_seq", { ascending: false }).limit(50),
  ]);
  if (error) throw new ApiError(500, "VERIFY_FAILED", "The audit trail could not be verified; nothing is reported as intact.");
  const row = (Array.isArray(data) ? data[0] : data) as { checked: number; first_seq: number | null; last_seq: number | null; broken_at_seq: number | null; reason: string | null } | undefined;
  if (!row) throw new ApiError(500, "VERIFY_FAILED", "The audit trail verification returned no result.");
  const report: AuditChainReport = {
    verifiedAt: new Date().toISOString(),
    checked: Number(row.checked),
    firstSeq: row.first_seq === null ? null : Number(row.first_seq),
    lastSeq: row.last_seq === null ? null : Number(row.last_seq),
    intact: row.broken_at_seq === null,
    brokenAtSeq: row.broken_at_seq === null ? null : Number(row.broken_at_seq),
    reason: row.reason,
    purges: (purges ?? []).map((p) => ({ upToSeq: Number(p.up_to_seq), purgedCount: Number(p.purged_count), purgedBefore: p.purged_before, purgedAt: p.purged_at })),
  };
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: report.intact ? "audit.chain_verified" : "audit.chain_broken",
    objectType: "audit_trail",
    objectId: tenantId,
    outcome: report.intact ? "success" : "failure",
    metadata: { checked: report.checked, lastSeq: report.lastSeq, brokenAtSeq: report.brokenAtSeq, reason: report.reason },
  });
  return report;
}
