import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import {
  IDENTITY_STATUSES,
  type FieldProvenance,
  type IdentityStatus,
  type IdentityType,
  type SourceAuthority,
  type SourcedFields,
  type SourcedIdentityField,
} from "@/lib/shared/types/agent-identity";
import { mergeSourcedFields } from "./sourcedMerge";

/**
 * INTEGRATION-P0-09 — the Identity module's published write path for
 * identity sources. The Integration module decides WHICH identity a source
 * record is (correlation); this module decides WHAT may change on it
 * (precedence, lifecycle) and writes it, so `identities` keeps a single
 * owner (non-negotiables #5, #6).
 *
 * Service role, because reconciliation runs in the background after the
 * request that started it (§15, the sync-job pattern). Every statement is
 * filtered on `tenantId`, and every identity id is re-read inside that
 * tenant before it is written (§14).
 */

const PAGE = 1000;
const MAX_IDENTITIES = 50_000;
const SOURCED_TYPES: IdentityType[] = ["HUMAN", "EXTERNAL", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"];

export type CorrelationCandidate = {
  id: string;
  identityType: IdentityType;
  displayName: string;
  email: string | null;
  username: string | null;
  startDate: string | null;
  status: IdentityStatus;
};

/** The tenant's identities of the given types, for a source to correlate against. */
export async function listIdentitiesForCorrelation(tenantId: string, types: IdentityType[]): Promise<CorrelationCandidate[]> {
  const supabase = supabaseServiceRole();
  const out: CorrelationCandidate[] = [];
  for (let from = 0; from < MAX_IDENTITIES; from += PAGE) {
    const { data, error } = await supabase
      .from("identities")
      .select("id, identity_type, display_name, email, username, start_date, status")
      .eq("tenant_id", tenantId)
      .in("identity_type", types.filter((t) => t !== "AI_AGENT"))
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`listIdentitiesForCorrelation: ${error.message}`);
    for (const r of data ?? []) {
      out.push({
        id: r.id as string,
        identityType: r.identity_type as IdentityType,
        displayName: r.display_name as string,
        email: (r.email as string | null) ?? null,
        username: (r.username as string | null) ?? null,
        startDate: (r.start_date as string | null) ?? null,
        status: r.status as IdentityStatus,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export type SourcedOp =
  | { op: "create"; ref: string; identityType: IdentityType; fields: SourcedFields }
  | { op: "update"; ref: string; identityId: string; fields: SourcedFields }
  | { op: "leaver"; ref: string; identityId: string };

export type SourcedResult = {
  ref: string;
  identityId: string | null;
  action: "created" | "updated" | "unchanged" | "leaver" | "error";
  changed: SourcedIdentityField[];
  skipped: SourcedIdentityField[];
  error?: string;
};

const COLUMN: Record<SourcedIdentityField, string> = {
  displayName: "display_name",
  email: "email",
  username: "username",
  subtype: "subtype",
  department: "department",
  title: "title",
  businessUnit: "business_unit",
  location: "location",
  employmentType: "employment_type",
  organization: "organization",
  startDate: "start_date",
  endDate: "end_date",
  status: "status",
  managerIdentityId: "manager_identity_id",
};

const PERSON_TYPES = new Set<IdentityType>(["HUMAN", "EXTERNAL"]);

/** A person's lifecycle state that matches a sourced status. */
function lifecycleFor(status: IdentityStatus, startDate: string | null, today: string): string {
  if (status === "terminated") return "TERMINATED";
  if (status === "archived") return "ARCHIVED";
  if (status === "inactive" || status === "disabled") return "DISABLED";
  if (status === "pending" || (startDate && startDate > today)) return "PRE_JOIN";
  return "ACTIVE";
}

function toRow(fields: SourcedFields): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields) as [SourcedIdentityField, string | null][]) row[COLUMN[k]] = v;
  return row;
}

/**
 * Applies one reconciliation run's decisions. Each op succeeds or fails on
 * its own; a failure is returned, never thrown, so one bad record cannot
 * abort the run or leave it half-reported (§17.5).
 */
export async function applySourcedIdentities(
  tenantId: string,
  source: SourceAuthority & { sourceName: string; runId: string },
  ops: SourcedOp[],
): Promise<SourcedResult[]> {
  const supabase = supabaseServiceRole();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const results: SourcedResult[] = [];

  // Existing rows for every update/leaver, read once and only in this tenant.
  const ids = [...new Set(ops.filter((o) => o.op !== "create").map((o) => (o as { identityId: string }).identityId))];
  const existing = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("identities")
      .select("id, identity_type, status, lifecycle_state, field_provenance, " + Object.values(COLUMN).join(", "))
      .eq("tenant_id", tenantId)
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`applySourcedIdentities: ${error.message}`);
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) existing.set(r.id as string, r);
  }

  const audit = (action: string, identityId: string, metadata: Record<string, unknown>) =>
    writeAudit({
      tenantId,
      actorId: null,
      actorType: "integration",
      action,
      objectType: "identity",
      objectId: identityId,
      outcome: "success",
      correlationId: source.runId,
      // Field names only, never values (#10, §17.7).
      metadata: { sourceId: source.sourceId, sourceName: source.sourceName, runId: source.runId, ...metadata },
    });

  for (const op of ops) {
    try {
      if (op.op === "create") {
        if (!SOURCED_TYPES.includes(op.identityType)) throw new Error(`a source cannot create ${op.identityType} identities`);
        if (!op.fields.displayName) throw new Error("no display name after mapping");
        const status = (op.fields.status && (IDENTITY_STATUSES as readonly string[]).includes(op.fields.status) ? op.fields.status : "active") as IdentityStatus;
        const provenance: FieldProvenance = {};
        for (const k of Object.keys(op.fields)) provenance[k] = { sourceId: source.sourceId, priority: source.priority, at: now };
        const { data, error } = await supabase
          .from("identities")
          .insert({
            tenant_id: tenantId,
            identity_type: op.identityType,
            ...toRow(op.fields),
            status,
            external: op.identityType === "EXTERNAL",
            lifecycle_state: PERSON_TYPES.has(op.identityType) ? lifecycleFor(status, op.fields.startDate ?? null, today) : null,
            source_system: source.sourceName.slice(0, 100),
            field_provenance: provenance,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "insert failed");
        results.push({ ref: op.ref, identityId: data.id as string, action: "created", changed: Object.keys(op.fields) as SourcedIdentityField[], skipped: [] });
        await audit("identity.created", data.id as string, { identityType: op.identityType, fields: Object.keys(op.fields) });
        continue;
      }

      const row = existing.get(op.identityId);
      if (!row) throw new Error("identity not found in this organization");

      if (op.op === "leaver") {
        if (row.status === "inactive" || row.status === "terminated" || row.status === "archived") {
          results.push({ ref: op.ref, identityId: op.identityId, action: "unchanged", changed: [], skipped: [] });
          continue;
        }
        const person = PERSON_TYPES.has(row.identity_type as IdentityType);
        const { error } = await supabase
          .from("identities")
          .update({ status: "inactive", ...(person ? { lifecycle_state: "LEAVE_PENDING" } : {}), updated_at: now })
          .eq("tenant_id", tenantId)
          .eq("id", op.identityId);
        if (error) throw new Error(error.message);
        results.push({ ref: op.ref, identityId: op.identityId, action: "leaver", changed: ["status"], skipped: [] });
        await audit("identity.leaver_detected", op.identityId, { from: row.status });
        continue;
      }

      const current: SourcedFields = {};
      for (const [k, col] of Object.entries(COLUMN) as [SourcedIdentityField, string][]) current[k] = (row[col] as string | null) ?? null;
      const merge = mergeSourcedFields(current, (row.field_provenance as FieldProvenance) ?? {}, op.fields, source, now);
      const changed = Object.keys(merge.changes) as SourcedIdentityField[];
      const provenanceChanged = JSON.stringify(merge.provenance) !== JSON.stringify(row.field_provenance ?? {});
      if (!changed.length && !provenanceChanged) {
        results.push({ ref: op.ref, identityId: op.identityId, action: "unchanged", changed: [], skipped: merge.skipped.map((s) => s.field) });
        continue;
      }
      const update: Record<string, unknown> = { ...toRow(merge.changes), field_provenance: merge.provenance };
      if (changed.length) update.updated_at = now;
      if (merge.changes.status !== undefined && PERSON_TYPES.has(row.identity_type as IdentityType)) {
        update.lifecycle_state = lifecycleFor(merge.changes.status as IdentityStatus, (merge.changes.startDate ?? row.start_date ?? null) as string | null, today);
      }
      const { error } = await supabase.from("identities").update(update).eq("tenant_id", tenantId).eq("id", op.identityId);
      if (error) throw new Error(error.message);
      results.push({ ref: op.ref, identityId: op.identityId, action: changed.length ? "updated" : "unchanged", changed, skipped: merge.skipped.map((s) => s.field) });
      if (changed.length) {
        await audit(changed.includes("status") ? "identity.status_changed" : "identity.updated", op.identityId, {
          changed,
          ...(changed.includes("status") ? { from: row.status, to: merge.changes.status } : {}),
        });
      }
    } catch (err) {
      results.push({
        ref: op.ref,
        identityId: op.op === "create" ? null : op.identityId,
        action: "error",
        changed: [],
        skipped: [],
        error: err instanceof Error ? err.message.slice(0, 300) : "unknown error",
      });
    }
  }
  return results;
}
