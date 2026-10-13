import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import {
  IDENTITY_STATUSES,
  type FieldProvenance,
  type IdentityAttributeDefinition,
  type IdentityStatus,
  type IdentityType,
  type SourceAuthority,
  type SourcedFields,
  type SourcedIdentityField,
} from "@/lib/shared/types/agent-identity";
import { coerceSourcedAttributes, mergeSourcedAttributes, mergeSourcedFields, planDisagreements, planRevert, type AttributeValue, type OpenDisagreement, type RecordedChange } from "./sourcedMerge";
import { detectLifecycleEvents, type DetectedEvent } from "./humanLifecycle";
import { assignOpenTasksToManager, recordLifecycleEvents } from "./humanLifecycleService";
import type { HumanLifecycleState } from "@/lib/shared/types/agent-identity";

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
  /** The identity's id in the system it came from (an import's external id). */
  sourceNativeId: string | null;
};

/** The tenant's identities of the given types, for a source to correlate against. */
export async function listIdentitiesForCorrelation(tenantId: string, types: IdentityType[]): Promise<CorrelationCandidate[]> {
  const supabase = supabaseServiceRole();
  const out: CorrelationCandidate[] = [];
  for (let from = 0; from < MAX_IDENTITIES; from += PAGE) {
    const { data, error } = await supabase
      .from("identities")
      .select("id, identity_type, display_name, email, username, start_date, status, source_native_id")
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
        sourceNativeId: (r.source_native_id as string | null) ?? null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export type SourcedOp =
  /** `nativeId`: kept as the identity's source reference, so a later import of the same record finds it. */
  | { op: "create"; ref: string; identityType: IdentityType; fields: SourcedFields; nativeId?: string; attributes?: SourcedAttributes }
  | { op: "update"; ref: string; identityId: string; fields: SourcedFields; attributes?: SourcedAttributes }
  | { op: "leaver"; ref: string; identityId: string };

/** INTEGRATION-P0-20: custom attribute values as the source sent them, by attribute name; typed here. */
export type SourcedAttributes = Record<string, string | null>;

export type SourcedResult = {
  ref: string;
  identityId: string | null;
  action: "created" | "updated" | "unchanged" | "leaver" | "error";
  changed: SourcedIdentityField[];
  skipped: SourcedIdentityField[];
  error?: string;
  /** Custom attributes this change wrote. */
  attributesChanged?: string[];
  /** Lifecycle events this change amounted to (people only), or why they could not be recorded. */
  lifecycleEvents?: string[];
  lifecycleError?: string;
  /** WID-H01: why this person's source disagreements could not be updated (the change itself applied). */
  conflictsError?: string;
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
      .select("id, identity_type, status, lifecycle_state, user_id, field_provenance, attributes, " + Object.values(COLUMN).join(", "))
      .eq("tenant_id", tenantId)
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`applySourcedIdentities: ${error.message}`);
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) existing.set(r.id as string, r);
  }

  // WID-H01: history and disagreements belong to identity sources. A file
  // import (its connection stands in as the source) has no source record to
  // unlink, so it records neither; its rows would also break their foreign
  // keys, failing every change it makes.
  const isIdentitySource = await identitySourceExists(supabase, tenantId, source.sourceId);

  // WID-H01: the open disagreements on these people, from any source, read once.
  const openDisagreements = new Map<string, OpenDisagreement[]>();
  const updateIds = isIdentitySource ? [...new Set(ops.filter((o) => o.op === "update").map((o) => (o as { identityId: string }).identityId))] : [];
  for (let i = 0; i < updateIds.length; i += 200) {
    const { data, error } = await supabase
      .from("identity_source_conflicts")
      .select("id, identity_id, field, kept_value, kept_source_id, other_value, other_source_id")
      .eq("tenant_id", tenantId)
      .in("identity_id", updateIds.slice(i, i + 200))
      .is("resolved_at", null);
    if (error) throw new Error(`applySourcedIdentities: ${error.message}`);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const list = openDisagreements.get(r.identity_id as string) ?? [];
      list.push({
        id: r.id as string,
        field: r.field as string,
        keptValue: (r.kept_value as string | null) ?? null,
        keptSourceId: (r.kept_source_id as string | null) ?? null,
        otherValue: (r.other_value as string | null) ?? null,
        otherSourceId: r.other_source_id as string,
      });
      openDisagreements.set(r.identity_id as string, list);
    }
  }

  // INTEGRATION-P0-20: the organization's attribute definitions, when a source sends custom attributes.
  const withAttributes = ops.some((o) => o.op !== "leaver" && o.attributes && Object.keys(o.attributes).length);
  const definitions = withAttributes ? await loadAttributeDefinitions(tenantId) : [];
  const unique = new Set(definitions.filter((d) => d.uniqueValue && d.active).map((d) => d.name));
  const claimed = new Map<string, string>();
  /** Typed values, or throws why the record cannot be used: an invalid value, or a unique value another identity holds. */
  const typedAttributes = async (given: SourcedAttributes | undefined, identityType: IdentityType, selfKey: string, selfId: string | null, current: Record<string, unknown> = {}) => {
    if (!given || !Object.keys(given).length) return {};
    const coerced = coerceSourcedAttributes(given, definitions, identityType);
    if ("invalid" in coerced) throw new Error(coerced.invalid);
    for (const [name, value] of Object.entries(coerced.values)) {
      if (!unique.has(name) || value === null) continue;
      const key = `${name}\u0000${String(value)}`;
      const holder = claimed.get(key);
      if (holder && holder !== selfKey) throw new Error(`attributes.${name}: another record in this run has the same value`);
      claimed.set(key, selfKey);
      if (current[name] === value) continue;
      let query = supabase.from("identities").select("id").eq("tenant_id", tenantId).eq(`attributes->>${name}`, String(value)).limit(1);
      if (selfId) query = query.neq("id", selfId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      if (data?.length) throw new Error(`attributes.${name}: another identity already has this value`);
    }
    return coerced.values;
  };

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

  // IDENTITY-P0-18: what each change to a person amounts to (joiner,
  // mover, leaver, ...), recorded after the change itself. A recording
  // failure is reported on the result, never hidden and never undoing it.
  const lifecycle = async (result: SourcedResult, subject: { id: string; displayName: string; userId: string | null; managerIdentityId: string | null }, detected: DetectedEvent[]) => {
    if (!detected.length) return;
    try {
      await recordLifecycleEvents(supabase, tenantId, subject, detected, { origin: "source", actorId: null, sourceId: source.sourceId, runId: source.runId });
      result.lifecycleEvents = detected.map((d) => d.eventType);
    } catch (err) {
      result.lifecycleError = err instanceof Error ? err.message.slice(0, 300) : "lifecycle events not recorded";
    }
  };

  // WID-H01 (owner decision): the higher-priority source still wins; each
  // disagreement is kept for review with both values and both sources. A
  // failure here is reported on the result, never undoing the change.
  const disagreementsFor = async (identityId: string, plan: ReturnType<typeof planDisagreements>, fieldsById: Map<string, string>): Promise<string | undefined> => {
    if (!isIdentitySource || (!plan.insert.length && !plan.update.length && !plan.resolve.length)) return undefined;
    try {
      if (plan.insert.length) {
        const { error } = await supabase.from("identity_source_conflicts").insert(
          plan.insert.map((c) => ({
            tenant_id: tenantId,
            identity_id: identityId,
            field: c.field,
            kept_value: c.keptValue,
            kept_source_id: c.keptSourceId,
            other_value: c.otherValue,
            other_source_id: source.sourceId,
            first_seen_at: now,
            last_seen_at: now,
          })),
        );
        if (error) throw new Error(error.message);
      }
      for (const c of plan.update) {
        const { error } = await supabase
          .from("identity_source_conflicts")
          .update({ kept_value: c.keptValue, kept_source_id: c.keptSourceId, other_value: c.otherValue, last_seen_at: now })
          .eq("tenant_id", tenantId)
          .eq("identity_id", identityId)
          .eq("id", c.id);
        if (error) throw new Error(error.message);
      }
      if (plan.resolve.length) {
        const { error } = await supabase
          .from("identity_source_conflicts")
          .update({ resolved_at: now })
          .eq("tenant_id", tenantId)
          .eq("identity_id", identityId)
          .in("id", plan.resolve);
        if (error) throw new Error(error.message);
      }
      if (plan.insert.length || plan.resolve.length) {
        await audit("identity.source_disagreements_changed", identityId, {
          opened: plan.insert.map((c) => c.field),
          resolved: plan.resolve.map((id) => fieldsById.get(id) ?? id),
        });
      }
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message.slice(0, 300) : "disagreements not recorded";
    }
  };

  // WID-H01 (owner decision): the value history behind "unlink with undo",
  // written before the change itself, so no change is applied without the
  // history to undo it (a failure here fails the record, not the run).
  const recordHistory = async (identityId: string, ref: string, entries: { field: string; oldValue: unknown; newValue: unknown; oldProvenance: unknown }[]) => {
    if (!isIdentitySource || !entries.length) return;
    const { error } = await supabase.from("identity_source_changes").insert(
      entries.map((e) => ({
        tenant_id: tenantId,
        identity_id: identityId,
        source_id: source.sourceId,
        external_id: ref.slice(0, 300),
        field: e.field,
        old_value: e.oldValue ?? null,
        new_value: e.newValue ?? null,
        old_provenance: e.oldProvenance ?? null,
        run_id: source.runId,
        changed_at: now,
      })),
    );
    if (error) throw new Error(`recording the change history: ${error.message}`);
  };

  for (const op of ops) {
    try {
      if (op.op === "create") {
        if (!SOURCED_TYPES.includes(op.identityType)) throw new Error(`a source cannot create ${op.identityType} identities`);
        if (!op.fields.displayName) throw new Error("no display name after mapping");
        const status = (op.fields.status && (IDENTITY_STATUSES as readonly string[]).includes(op.fields.status) ? op.fields.status : "active") as IdentityStatus;
        const attributes = Object.fromEntries(Object.entries(await typedAttributes(op.attributes, op.identityType, op.ref, null)).filter(([, v]) => v !== null));
        const provenance: FieldProvenance = {};
        for (const k of Object.keys(op.fields)) provenance[k] = { sourceId: source.sourceId, priority: source.priority, at: now };
        for (const k of Object.keys(attributes)) provenance[`attributes.${k}`] = { sourceId: source.sourceId, priority: source.priority, at: now };
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
            ...(op.nativeId ? { source_native_id: op.nativeId.slice(0, 300) } : {}),
            ...(Object.keys(attributes).length ? { attributes } : {}),
            field_provenance: provenance,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "insert failed");
        const created: SourcedResult = { ref: op.ref, identityId: data.id as string, action: "created", changed: Object.keys(op.fields) as SourcedIdentityField[], skipped: [] };
        if (Object.keys(attributes).length) created.attributesChanged = Object.keys(attributes);
        results.push(created);
        await audit("identity.created", data.id as string, { identityType: op.identityType, fields: Object.keys(op.fields), ...(created.attributesChanged ? { attributes: created.attributesChanged } : {}) });
        if (PERSON_TYPES.has(op.identityType)) {
          const state = lifecycleFor(status, op.fields.startDate ?? null, today) as HumanLifecycleState;
          await lifecycle(
            created,
            { id: data.id as string, displayName: op.fields.displayName, userId: null, managerIdentityId: op.fields.managerIdentityId ?? null },
            detectLifecycleEvents(null, { ...op.fields, lifecycleState: state }),
          );
        }
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
        await recordHistory(op.identityId, op.ref, [{ field: "status", oldValue: row.status, newValue: "inactive", oldProvenance: ((row.field_provenance as FieldProvenance) ?? {}).status }]);
        const { error } = await supabase
          .from("identities")
          .update({ status: "inactive", ...(person ? { lifecycle_state: "LEAVE_PENDING" } : {}), updated_at: now })
          .eq("tenant_id", tenantId)
          .eq("id", op.identityId);
        if (error) throw new Error(error.message);
        const left: SourcedResult = { ref: op.ref, identityId: op.identityId, action: "leaver", changed: ["status"], skipped: [] };
        results.push(left);
        await audit("identity.leaver_detected", op.identityId, { from: row.status });
        if (person) {
          const before = { lifecycleState: (row.lifecycle_state as HumanLifecycleState | null) ?? null };
          await lifecycle(
            left,
            { id: op.identityId, displayName: row.display_name as string, userId: (row.user_id as string | null) ?? null, managerIdentityId: (row.manager_identity_id as string | null) ?? null },
            detectLifecycleEvents(before, { lifecycleState: "LEAVE_PENDING" }),
          );
        }
        continue;
      }

      const current: SourcedFields = {};
      for (const [k, col] of Object.entries(COLUMN) as [SourcedIdentityField, string][]) current[k] = (row[col] as string | null) ?? null;
      const merge = mergeSourcedFields(current, (row.field_provenance as FieldProvenance) ?? {}, op.fields, source, now);
      const currentAttributes = (row.attributes as Record<string, AttributeValue | null>) ?? {};
      const incomingAttributes = await typedAttributes(op.attributes, row.identity_type as IdentityType, op.ref, op.identityId, currentAttributes);
      const attributeMerge = mergeSourcedAttributes(currentAttributes, merge.provenance, incomingAttributes, source, now);
      const changed = Object.keys(merge.changes) as SourcedIdentityField[];
      const attributesChanged = Object.keys(attributeMerge.changes);
      const provenanceChanged = JSON.stringify(attributeMerge.provenance) !== JSON.stringify(row.field_provenance ?? {});
      const open = openDisagreements.get(op.identityId) ?? [];
      const written: Record<string, unknown> = { ...merge.changes };
      for (const [name, value] of Object.entries(attributeMerge.changes)) written[`attributes.${name}`] = value;
      const disagreementPlan = planDisagreements(
        open,
        source.sourceId,
        [...Object.keys(op.fields).filter((k) => op.fields[k as SourcedIdentityField] !== undefined), ...Object.keys(incomingAttributes).map((n) => `attributes.${n}`)],
        [...merge.disagreements, ...attributeMerge.disagreements.map((d) => ({ ...d, field: `attributes.${d.field}` }))],
        written,
      );
      const conflictsError = await disagreementsFor(op.identityId, disagreementPlan, new Map(open.map((o) => [o.id, o.field])));
      if (!changed.length && !attributesChanged.length && !provenanceChanged) {
        results.push({ ref: op.ref, identityId: op.identityId, action: "unchanged", changed: [], skipped: merge.skipped.map((s) => s.field), ...(conflictsError ? { conflictsError } : {}) });
        continue;
      }
      const update: Record<string, unknown> = { ...toRow(merge.changes), field_provenance: attributeMerge.provenance };
      if (attributesChanged.length) {
        const next = { ...currentAttributes };
        for (const [name, value] of Object.entries(attributeMerge.changes)) {
          if (value === null || value === undefined) delete next[name];
          else next[name] = value;
        }
        update.attributes = next;
      }
      if (changed.length || attributesChanged.length) update.updated_at = now;
      if (merge.changes.status !== undefined && PERSON_TYPES.has(row.identity_type as IdentityType)) {
        update.lifecycle_state = lifecycleFor(merge.changes.status as IdentityStatus, (merge.changes.startDate ?? row.start_date ?? null) as string | null, today);
      }
      const before = (row.field_provenance as FieldProvenance) ?? {};
      await recordHistory(op.identityId, op.ref, [
        ...changed.map((field) => ({ field, oldValue: current[field] ?? null, newValue: merge.changes[field] ?? null, oldProvenance: before[field] })),
        ...attributesChanged.map((name) => ({
          field: `attributes.${name}`,
          oldValue: currentAttributes[name] ?? null,
          newValue: attributeMerge.changes[name] ?? null,
          oldProvenance: before[`attributes.${name}`],
        })),
      ]);
      const { error } = await supabase.from("identities").update(update).eq("tenant_id", tenantId).eq("id", op.identityId);
      if (error) throw new Error(error.message);
      const updated: SourcedResult = {
        ref: op.ref,
        identityId: op.identityId,
        action: changed.length || attributesChanged.length ? "updated" : "unchanged",
        changed,
        skipped: merge.skipped.map((s) => s.field),
        ...(attributesChanged.length ? { attributesChanged } : {}),
        ...(conflictsError ? { conflictsError } : {}),
      };
      results.push(updated);
      if (changed.length && PERSON_TYPES.has(row.identity_type as IdentityType)) {
        const beforeState = (row.lifecycle_state as HumanLifecycleState | null) ?? null;
        const afterState = ((update.lifecycle_state as HumanLifecycleState | undefined) ?? beforeState) as HumanLifecycleState | null;
        await lifecycle(
          updated,
          {
            id: op.identityId,
            displayName: (merge.changes.displayName ?? row.display_name) as string,
            userId: (row.user_id as string | null) ?? null,
            managerIdentityId: (merge.changes.managerIdentityId ?? row.manager_identity_id ?? null) as string | null,
          },
          detectLifecycleEvents({ ...current, lifecycleState: beforeState }, { ...current, ...merge.changes, lifecycleState: afterState }),
        );
        if (merge.changes.managerIdentityId && !current.managerIdentityId) {
          try {
            await assignOpenTasksToManager(supabase, tenantId, {
              id: op.identityId,
              displayName: (merge.changes.displayName ?? row.display_name) as string,
              userId: (row.user_id as string | null) ?? null,
              managerIdentityId: merge.changes.managerIdentityId,
            });
          } catch (err) {
            updated.lifecycleError = err instanceof Error ? err.message.slice(0, 300) : "lifecycle tasks not assigned";
          }
        }
      }
      if (changed.length || attributesChanged.length) {
        await audit(changed.includes("status") ? "identity.status_changed" : "identity.updated", op.identityId, {
          changed,
          ...(attributesChanged.length ? { attributes: attributesChanged } : {}),
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

/**
 * WID-H01 (owner decision): undoes what one source record changed on an
 * identity, when the record is unlinked from it. Each field the record
 * changed goes back to its value before the first change, with that
 * value's provenance, unless it has changed since (then it is kept and
 * reported). A restored status also restores the person's lifecycle
 * state; it starts no lifecycle event (an undo is not a joiner or mover).
 *
 * Service role, called by the Integration module's unlink after its own
 * authorization; every statement is filtered on `tenantId`, and the
 * identity is written only if it has not changed since it was read.
 */
export async function revertSourceRecord(
  tenantId: string,
  actorId: string,
  record: { identityId: string; sourceId: string; externalId: string },
): Promise<{ restored: string[]; kept: string[] }> {
  const supabase = supabaseServiceRole();
  const now = new Date().toISOString();
  const [{ data: changeRows, error: changeError }, { data: row, error: rowError }] = await Promise.all([
    supabase
      .from("identity_source_changes")
      .select("id, field, old_value, new_value, old_provenance, changed_at")
      .eq("tenant_id", tenantId)
      .eq("identity_id", record.identityId)
      .eq("source_id", record.sourceId)
      .eq("external_id", record.externalId)
      .is("undone_at", null)
      .order("changed_at")
      .limit(2000),
    supabase
      .from("identities")
      .select("id, identity_type, attributes, field_provenance, updated_at, " + Object.values(COLUMN).join(", "))
      .eq("tenant_id", tenantId)
      .eq("id", record.identityId)
      .maybeSingle(),
  ]);
  if (changeError) throw new Error(`revertSourceRecord: ${changeError.message}`);
  if (rowError) throw new Error(`revertSourceRecord: ${rowError.message}`);
  const identity = row as unknown as Record<string, unknown> | null;
  if (!identity) throw new Error("identity not found in this organization");

  const changes: RecordedChange[] = ((changeRows ?? []) as Record<string, unknown>[]).map((c) => ({
    id: c.id as string,
    field: c.field as string,
    oldValue: c.old_value,
    newValue: c.new_value,
    oldProvenance: (c.old_provenance as FieldProvenance[string] | null) ?? null,
    changedAt: c.changed_at as string,
  }));
  const attributes = { ...((identity.attributes as Record<string, AttributeValue | null>) ?? {}) };
  const current: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(COLUMN) as [SourcedIdentityField, string][]) current[k] = identity[col] ?? null;
  for (const [name, value] of Object.entries(attributes)) current[`attributes.${name}`] = value;
  const plan = planRevert(changes, current);

  if (plan.restore.length) {
    const provenance: FieldProvenance = { ...((identity.field_provenance as FieldProvenance) ?? {}) };
    const update: Record<string, unknown> = {};
    let attributesChanged = false;
    for (const r of plan.restore) {
      if (r.field.startsWith("attributes.")) {
        const name = r.field.slice("attributes.".length);
        if (r.value === null || r.value === undefined) delete attributes[name];
        else attributes[name] = r.value as AttributeValue;
        attributesChanged = true;
      } else if (r.field in COLUMN) {
        update[COLUMN[r.field as SourcedIdentityField]] = r.value ?? null;
      } else continue;
      if (r.provenance) provenance[r.field] = r.provenance;
      else delete provenance[r.field];
    }
    if (attributesChanged) update.attributes = attributes;
    const status = update.status as IdentityStatus | undefined;
    if (status && PERSON_TYPES.has(identity.identity_type as IdentityType)) {
      update.lifecycle_state = lifecycleFor(status, ((update.start_date ?? identity.start_date) as string | null) ?? null, now.slice(0, 10));
    }
    const { data: written, error } = await supabase
      .from("identities")
      .update({ ...update, field_provenance: provenance, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", record.identityId)
      .eq("updated_at", identity.updated_at as string)
      .select("id");
    if (error) throw new Error(`revertSourceRecord: ${error.message}`);
    if (!written?.length) throw new Error("the identity changed meanwhile; try again");
  }
  for (let i = 0; i < plan.undone.length; i += 200) {
    const { error } = await supabase
      .from("identity_source_changes")
      .update({ undone_at: now })
      .eq("tenant_id", tenantId)
      .eq("identity_id", record.identityId)
      .in("id", plan.undone.slice(i, i + 200));
    if (error) throw new Error(`revertSourceRecord: ${error.message}`);
  }
  const restored = plan.restore.map((r) => r.field);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.source_changes_undone",
    objectType: "identity",
    objectId: record.identityId,
    outcome: "success",
    // Field names only, never values (#10, §17.7).
    metadata: { sourceId: record.sourceId, restored, kept: plan.kept },
    // WID-H07, identifiers only: a source's record id may be an email.
    typedText: { externalId: record.externalId },
  });
  return { restored, kept: plan.kept };
}

/** Whether `sourceId` is one of this organization's identity sources (a file import's connection is not). */
async function identitySourceExists(supabase: ReturnType<typeof supabaseServiceRole>, tenantId: string, sourceId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) return false;
  const { data, error } = await supabase.from("identity_sources").select("id").eq("tenant_id", tenantId).eq("id", sourceId).maybeSingle();
  if (error) throw new Error(`applySourcedIdentities: ${error.message}`);
  return Boolean(data);
}

async function loadAttributeDefinitions(tenantId: string) {
  const { data, error } = await supabaseServiceRole()
    .from("identity_attribute_definitions")
    .select("tenant_id, name, display_name, identity_type, data_type, required, allowed_values, validation_regex, active, unique_value")
    .eq("tenant_id", tenantId)
    .limit(500);
  if (error) throw new Error(`applySourcedIdentities: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => r.tenant_id === tenantId)
    .map((r) => ({
      name: r.name as string,
      displayName: r.display_name as string,
      identityType: (r.identity_type as IdentityType | null) ?? null,
      dataType: r.data_type as IdentityAttributeDefinition["dataType"],
      required: Boolean(r.required),
      allowedValues: (r.allowed_values as string[] | null) ?? [],
      validationRegex: (r.validation_regex as string | null) ?? null,
      active: Boolean(r.active),
      uniqueValue: Boolean(r.unique_value),
    }));
}

export type SourcedPreview = {
  ref: string;
  identityId: string | null;
  action: "create" | "update" | "unchanged" | "error";
  changes: { field: SourcedIdentityField; from: string | null; to: string | null }[];
  /** Fields left as they are: a higher-precedence source set them, or this source only fills blanks. */
  skipped: { field: SourcedIdentityField; reason: "higher_precedence" | "not_authoritative" }[];
  error?: string;
};

/**
 * What `applySourcedIdentities` would change, without writing anything: the
 * same precedence rules (mergeSourcedFields) over the same rows, for a
 * preview a person confirms first. Leavers are not previewed here.
 */
export async function previewSourcedIdentities(tenantId: string, source: SourceAuthority, ops: SourcedOp[]): Promise<SourcedPreview[]> {
  const supabase = supabaseServiceRole();
  const now = new Date().toISOString();
  const ids = [...new Set(ops.filter((o) => o.op === "update").map((o) => (o as { identityId: string }).identityId))];
  const existing = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("identities")
      .select("id, field_provenance, " + Object.values(COLUMN).join(", "))
      .eq("tenant_id", tenantId)
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`previewSourcedIdentities: ${error.message}`);
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) existing.set(r.id as string, r);
  }
  return ops.map((op): SourcedPreview => {
    if (op.op === "create") {
      const changes = (Object.entries(op.fields) as [SourcedIdentityField, string | null][]).filter(([, v]) => v !== null).map(([field, to]) => ({ field, from: null, to }));
      return { ref: op.ref, identityId: null, action: "create", changes, skipped: [] };
    }
    if (op.op === "leaver") return { ref: op.ref, identityId: op.identityId, action: "error", changes: [], skipped: [], error: "leavers are not previewed" };
    const row = existing.get(op.identityId);
    if (!row) return { ref: op.ref, identityId: op.identityId, action: "error", changes: [], skipped: [], error: "identity not found in this organization" };
    const current: SourcedFields = {};
    for (const [k, col] of Object.entries(COLUMN) as [SourcedIdentityField, string][]) current[k] = (row[col] as string | null) ?? null;
    const merge = mergeSourcedFields(current, (row.field_provenance as FieldProvenance) ?? {}, op.fields, source, now);
    const changes = (Object.entries(merge.changes) as [SourcedIdentityField, string | null][]).map(([field, to]) => ({ field, from: current[field] ?? null, to }));
    return { ref: op.ref, identityId: op.identityId, action: changes.length ? "update" : "unchanged", changes, skipped: merge.skipped.map(({ field, reason }) => ({ field, reason })) };
  });
}
