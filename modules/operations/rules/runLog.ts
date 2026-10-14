import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { RunLogEntry } from "./runtime";

/**
 * OPERATIONS-P0-11 — the automation run log (migration 0167). The owning
 * module records what its rules did, after deciding it, with the rule
 * version; members read it. Append-only.
 */

export type RuleTable = "lifecycle_rules";

export type RuleRunRecord = Omit<RunLogEntry, "outcome"> & { outcome: RunLogEntry["outcome"] | "skipped"; detail?: string };

export type RuleRun = {
  id: string;
  ruleId: string;
  ruleVersion: number;
  subjectType: string;
  subjectId: string;
  trigger: string;
  mode: string;
  outcome: string;
  effects: unknown[];
  detail: string | null;
  createdAt: string;
};

/**
 * Records run-log entries for one organization. Service role (the rule ran
 * in a system context); every row carries the tenant passed in. A failure
 * is thrown: a rule that changed something must not go unlogged silently.
 */
export async function recordRuleRuns(tenantId: string, ruleTable: RuleTable, subjectType: string, entries: RuleRunRecord[], correlationId?: string | null): Promise<void> {
  if (!entries.length) return;
  const { error } = await supabaseServiceRole()
    .from("rule_runs")
    .insert(
      entries.map((e) => ({
        tenant_id: tenantId,
        rule_table: ruleTable,
        rule_id: e.ruleId,
        rule_version: e.ruleVersion,
        subject_type: subjectType,
        subject_id: e.subjectId,
        trigger: e.trigger,
        mode: e.mode,
        outcome: e.outcome,
        effects: e.effects,
        detail: (e.detail ?? e.error ?? null)?.slice(0, 2000) ?? null,
        correlation_id: correlationId?.slice(0, 200) ?? null,
      })),
    );
  if (error) throw new Error(`recording the rule run log: ${error.message}`);
}

/** The latest runs of one rule, or for one subject, in this organization (RLS and an explicit tenant filter). */
export async function listRuleRuns(tenantId: string, filter: { ruleId?: string; subjectId?: string; limit?: number }): Promise<RuleRun[]> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((filter.ruleId && !uuid.test(filter.ruleId)) || (filter.subjectId && !uuid.test(filter.subjectId))) return [];
  const supabase = await supabaseServer();
  let query = supabase.from("rule_runs").select("*").eq("tenant_id", tenantId);
  if (filter.ruleId) query = query.eq("rule_id", filter.ruleId);
  if (filter.subjectId) query = query.eq("subject_id", filter.subjectId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    ruleId: r.rule_id as string,
    ruleVersion: r.rule_version as number,
    subjectType: r.subject_type as string,
    subjectId: r.subject_id as string,
    trigger: r.trigger as string,
    mode: r.mode as string,
    outcome: r.outcome as string,
    effects: (r.effects as unknown[]) ?? [],
    detail: (r.detail as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}
