import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { notify } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type {
  HumanLifecycleState,
  IdentityLifecycleEvent,
  IdentityLifecycleTask,
  IdentityStatus,
  LifecycleEventType,
  LifecycleTaskStatus,
  LifecycleTaskType,
} from "@/lib/shared/types/agent-identity";
import { HUMAN_TRANSITIONS, statusForState, tasksForEvent, type DetectedEvent } from "./humanLifecycle";
import { assignOwner, removeOwner } from "./owners";

/**
 * IDENTITY-P0-18 — recording the human lifecycle and its governed work.
 *
 * Every read and write filters on the request's tenant. Recording takes
 * the client to use: the calling user's (a manual transition, under RLS)
 * or the service role (a source run, after the request). Tasks are closed
 * by people with a note; the ownership transfer is the one task this
 * module carries out itself, because every object it touches is its own
 * (identities, relationships, agent owners).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERSON = new Set(["HUMAN", "EXTERNAL"]);

type Row = Record<string, unknown>;

const EVENT_LABEL: Record<LifecycleEventType, string> = {
  joiner: "Joiner",
  mover: "Mover",
  leaver: "Leaver",
  rehire: "Rehire",
  conversion: "Conversion",
  manager_change: "New manager",
  leaver_cancelled: "Departure cancelled",
  disabled: "Disabled",
  terminated: "Terminated",
  archived: "Archived",
  hire_cancelled: "Hire cancelled",
};

function toEvent(r: Row): IdentityLifecycleEvent {
  return {
    id: r.id as string,
    identityId: r.identity_id as string,
    eventType: r.event_type as LifecycleEventType,
    fromState: (r.from_state as HumanLifecycleState | null) ?? null,
    toState: (r.to_state as HumanLifecycleState | null) ?? null,
    changedFields: (r.changed_fields as string[]) ?? [],
    origin: r.origin as "manual" | "source",
    sourceId: (r.source_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    actorId: (r.actor_id as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toTask(r: Row): IdentityLifecycleTask {
  return {
    id: r.id as string,
    eventId: r.event_id as string,
    identityId: r.identity_id as string,
    taskType: r.task_type as LifecycleTaskType,
    status: r.status as LifecycleTaskStatus,
    assigneeIdentityId: (r.assignee_identity_id as string | null) ?? null,
    detail: (r.detail as Record<string, unknown>) ?? {},
    resolutionNote: (r.resolution_note as string | null) ?? null,
    completedBy: (r.completed_by as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export type LifecycleSubject = { id: string; displayName: string; userId: string | null; managerIdentityId: string | null };

/**
 * Records detected events for one person and opens their tasks. The
 * manager (when they can sign in) is told. Failures are thrown to the
 * caller, which decides whether they fail its operation.
 */
export async function recordLifecycleEvents(
  client: SupabaseClient,
  tenantId: string,
  subject: LifecycleSubject,
  detected: DetectedEvent[],
  meta: { origin: "manual" | "source"; actorId: string | null; sourceId?: string | null; runId?: string | null; note?: string | null },
): Promise<IdentityLifecycleEvent[]> {
  const recorded: IdentityLifecycleEvent[] = [];
  for (const d of detected) {
    const { data, error } = await client
      .from("identity_lifecycle_events")
      .insert({
        tenant_id: tenantId,
        identity_id: subject.id,
        event_type: d.eventType,
        from_state: d.fromState,
        to_state: d.toState,
        changed_fields: d.changedFields,
        origin: meta.origin,
        source_id: meta.sourceId ?? null,
        run_id: meta.runId ?? null,
        actor_id: meta.actorId,
        note: meta.note ?? null,
      })
      .select()
      .single();
    if (error || !data) throw new Error(`recording a lifecycle event: ${error?.message ?? "no row"}`);
    const event = toEvent(data);
    recorded.push(event);

    const taskTypes = tasksForEvent(d.eventType, { hasSignIn: Boolean(subject.userId) });
    if (taskTypes.length) {
      const { error: taskError } = await client.from("identity_lifecycle_tasks").insert(
        taskTypes.map((t) => ({
          tenant_id: tenantId,
          event_id: event.id,
          identity_id: subject.id,
          task_type: t,
          // The manager does the access work; ownership transfer and
          // sign-in go to identity administrators (no assignee).
          assignee_identity_id: t === "request_baseline_access" || t === "review_access" ? subject.managerIdentityId : null,
          detail: d.changedFields.length ? { changedFields: d.changedFields } : {},
        })),
      );
      if (taskError) throw new Error(`opening lifecycle tasks: ${taskError.message}`);
    }

    await writeAudit({
      tenantId,
      actorId: meta.actorId,
      actorType: meta.origin === "source" ? "integration" : "user",
      action: "identity.lifecycle_event",
      objectType: "identity",
      objectId: subject.id,
      outcome: "success",
      correlationId: meta.runId ?? undefined,
      metadata: { eventType: d.eventType, fromState: d.fromState, toState: d.toState, changedFields: d.changedFields, tasks: taskTypes, sourceId: meta.sourceId ?? null },
    });

    if (taskTypes.length && subject.managerIdentityId) {
      const { data: manager } = await client.from("identities").select("user_id").eq("tenant_id", tenantId).eq("id", subject.managerIdentityId).maybeSingle();
      if (manager?.user_id) {
        await notify({
          tenantId,
          userId: manager.user_id as string,
          type: "lifecycle_task",
          title: `${EVENT_LABEL[d.eventType]}: ${subject.displayName}`,
          body: `${subject.displayName} needs lifecycle work: ${taskTypes.map((t) => t.replace(/_/g, " ")).join(", ")}.`,
          referenceType: "identity",
          referenceId: subject.id,
        });
      }
    }
  }
  return recorded;
}

/**
 * A person's first manager takes over their open, unassigned access work
 * (the joiner's task was opened before the manager was known) and is told.
 */
export async function assignOpenTasksToManager(client: SupabaseClient, tenantId: string, subject: LifecycleSubject): Promise<number> {
  if (!subject.managerIdentityId) return 0;
  const { data, error } = await client
    .from("identity_lifecycle_tasks")
    .update({ assignee_identity_id: subject.managerIdentityId })
    .eq("tenant_id", tenantId)
    .eq("identity_id", subject.id)
    .eq("status", "open")
    .is("assignee_identity_id", null)
    .in("task_type", ["request_baseline_access", "review_access"])
    .select("task_type");
  if (error) throw new Error(`assigning lifecycle tasks: ${error.message}`);
  if (data?.length) {
    const { data: manager } = await client.from("identities").select("user_id").eq("tenant_id", tenantId).eq("id", subject.managerIdentityId).maybeSingle();
    if (manager?.user_id) {
      await notify({
        tenantId,
        userId: manager.user_id as string,
        type: "lifecycle_task",
        title: `New report: ${subject.displayName}`,
        body: `${subject.displayName} needs lifecycle work: ${data.map((t) => String(t.task_type).replace(/_/g, " ")).join(", ")}.`,
        referenceType: "identity",
        referenceId: subject.id,
      });
    }
  }
  return data?.length ?? 0;
}

// ---------------------------------------------------------------- manual transitions

/**
 * A person moves someone through the lifecycle (IDENTITY-P0-18). Only the
 * governed transitions are allowed; the change applies only if nobody
 * moved them meanwhile; a departure or a cancelled hire needs a reason.
 */
export async function transitionHumanLifecycle(
  tenantId: string,
  actorId: string,
  identityId: string,
  toState: HumanLifecycleState,
  note: string | null,
): Promise<IdentityLifecycleEvent> {
  if (!UUID_RE.test(identityId)) throw new ApiError(404, "NOT_FOUND", "No such identity in this organization");
  const supabase = await supabaseServer();
  const { data: row, error } = await supabase
    .from("identities")
    .select("id, identity_type, display_name, user_id, manager_identity_id, status, lifecycle_state")
    .eq("tenant_id", tenantId)
    .eq("id", identityId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such identity in this organization");
  if (!PERSON.has(row.identity_type as string)) throw new ApiError(400, "VALIDATION_FAILED", "Only people have a joiner-to-leaver lifecycle");
  const from = row.lifecycle_state as HumanLifecycleState | null;
  const eventType = from ? HUMAN_TRANSITIONS[from]?.[toState] : undefined;
  if (!from || !eventType) throw new ApiError(409, "INVALID_TRANSITION", `A person cannot go from ${from ?? "no state"} to ${toState}`);
  const reason = typeof note === "string" && note.trim() ? note.trim().slice(0, 2000) : null;
  if (!reason && ["leaver", "disabled", "terminated", "hire_cancelled"].includes(eventType)) {
    throw new ApiError(400, "VALIDATION_FAILED", "note: give the reason for this change");
  }

  const status = statusForState(toState, row.status as IdentityStatus);
  const { data: updated, error: updateError } = await supabase
    .from("identities")
    .update({ lifecycle_state: toState, status, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", identityId)
    .eq("lifecycle_state", from)
    .select("id");
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  if (!updated?.length) throw new ApiError(409, "CONFLICT", "Someone else changed this person's lifecycle; reload and try again");

  const [event] = await recordLifecycleEvents(
    supabase,
    tenantId,
    { id: identityId, displayName: row.display_name as string, userId: (row.user_id as string | null) ?? null, managerIdentityId: (row.manager_identity_id as string | null) ?? null },
    [{ eventType, changedFields: ["lifecycleState"], fromState: from, toState }],
    { origin: "manual", actorId, note: reason },
  );
  return event;
}

// ---------------------------------------------------------------- reads

export async function listHumanLifecycleEvents(tenantId: string, identityId: string, limit = 50): Promise<IdentityLifecycleEvent[]> {
  if (!UUID_RE.test(identityId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_lifecycle_events")
    .select()
    .eq("tenant_id", tenantId)
    .eq("identity_id", identityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toEvent);
}

export type LifecycleTaskView = IdentityLifecycleTask & { identityName: string; assigneeName: string | null; eventType: LifecycleEventType };

export async function listLifecycleTasks(
  tenantId: string,
  filter: { identityId?: string; status?: LifecycleTaskStatus } = {},
  limit = 100,
): Promise<LifecycleTaskView[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("identity_lifecycle_tasks")
    .select("*, identity_lifecycle_events!inner(event_type)")
    .eq("tenant_id", tenantId)
    .eq("identity_lifecycle_events.tenant_id", tenantId);
  if (filter.identityId) {
    if (!UUID_RE.test(filter.identityId)) return [];
    query = query.eq("identity_id", filter.identityId);
  }
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(Math.min(limit, 500));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.flatMap((r) => [r.identity_id, r.assignee_identity_id]).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people, error: namesError } = await supabase.from("identities").select("id, display_name").eq("tenant_id", tenantId).in("id", ids);
    if (namesError) throw new ApiError(500, "QUERY_FAILED", namesError.message);
    for (const p of people ?? []) names.set(p.id as string, p.display_name as string);
  }
  return rows.map((r) => ({
    ...toTask(r),
    eventType: (r.identity_lifecycle_events as { event_type: LifecycleEventType }).event_type,
    identityName: names.get(r.identity_id as string) ?? "Unknown identity",
    assigneeName: r.assignee_identity_id ? (names.get(r.assignee_identity_id as string) ?? null) : null,
  }));
}

export async function countOpenLifecycleTasks(tenantId: string): Promise<number> {
  const supabase = await supabaseServer();
  const { count, error } = await supabase.from("identity_lifecycle_tasks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return count ?? 0;
}

/** Everything a person is accountable for, for an ownership transfer. */
export async function getOwnershipFootprint(tenantId: string, identityId: string) {
  if (!UUID_RE.test(identityId)) throw new ApiError(404, "NOT_FOUND", "No such identity");
  const supabase = await supabaseServer();
  const { data: person, error } = await supabase.from("identities").select("id, user_id").eq("tenant_id", tenantId).eq("id", identityId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!person) throw new ApiError(404, "NOT_FOUND", "No such identity");
  const head = () => supabase.from("identities").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [owned, sponsored, reports, agents] = await Promise.all([
    head().eq("owner_identity_id", identityId),
    head().eq("sponsor_identity_id", identityId),
    head().eq("manager_identity_id", identityId),
    person.user_id
      ? supabase
          .from("agent_owners")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("user_id", person.user_id as string)
          .is("removed_at", null)
          .neq("owner_type", "delegated_owner")
      : Promise.resolve({ count: 0, error: null }),
  ]);
  for (const r of [owned, sponsored, reports, agents]) if (r.error) throw new ApiError(500, "QUERY_FAILED", r.error.message);
  return { ownedIdentities: owned.count ?? 0, sponsoredIdentities: sponsored.count ?? 0, directReports: reports.count ?? 0, ownedAgents: agents.count ?? 0 };
}

// ---------------------------------------------------------------- closing tasks

async function loadOpenTask(tenantId: string, taskId: string): Promise<IdentityLifecycleTask> {
  if (!UUID_RE.test(taskId)) throw new ApiError(404, "NOT_FOUND", "No such task");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("identity_lifecycle_tasks").select().eq("tenant_id", tenantId).eq("id", taskId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "No such task");
  const task = toTask(data);
  if (task.status !== "open") throw new ApiError(409, "ALREADY_CLOSED", "This task is already closed");
  return task;
}

async function closeTask(tenantId: string, actorId: string, task: IdentityLifecycleTask, status: "done" | "skipped", note: string | null, detail?: Record<string, unknown>) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("identity_lifecycle_tasks")
    .update({
      status,
      resolution_note: note,
      completed_by: actorId,
      completed_at: new Date().toISOString(),
      ...(detail ? { detail: { ...task.detail, ...detail } } : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", task.id)
    .eq("status", "open")
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data?.length) throw new ApiError(409, "ALREADY_CLOSED", "This task is already closed");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.lifecycle_task_closed",
    objectType: "identity",
    objectId: task.identityId,
    outcome: "success",
    metadata: { taskId: task.id, taskType: task.taskType, status, ...(detail ?? {}) },
  });
}

/**
 * Closes a task a person carried out elsewhere (e.g. access removed in the
 * target system). Skipping needs a reason. The ownership transfer is
 * closed by transferOwnership(), which actually does it.
 */
export async function completeLifecycleTask(tenantId: string, actorId: string, taskId: string, input: { status?: unknown; note?: unknown }): Promise<void> {
  const status = input.status;
  if (status !== "done" && status !== "skipped") throw new ApiError(400, "VALIDATION_FAILED", "status: done or skipped");
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 2000) : null;
  if (status === "skipped" && !note) throw new ApiError(400, "VALIDATION_FAILED", "note: say why this task is skipped");
  const task = await loadOpenTask(tenantId, taskId);
  if (task.taskType === "transfer_ownership" && status === "done") {
    const footprint = await getOwnershipFootprint(tenantId, task.identityId);
    const remaining = footprint.ownedIdentities + footprint.sponsoredIdentities + footprint.directReports + footprint.ownedAgents;
    if (remaining > 0) throw new ApiError(409, "STILL_OWNS", "This person still owns or manages things; transfer them first, or skip with a reason");
  }
  await closeTask(tenantId, actorId, task, status, note);
}

/**
 * Hands everything a leaver is accountable for to another active person:
 * identities they own, sponsor or manage, their current ownership
 * relationships, and the AI agents they own (to the new person's sign-in
 * account, so the agent's owner is someone who can act). Then closes the
 * task. Delegated agent ownership is left to expire rather than moved.
 */
export async function transferOwnership(tenantId: string, actorId: string, taskId: string, toIdentityId: string) {
  const task = await loadOpenTask(tenantId, taskId);
  if (task.taskType !== "transfer_ownership") throw new ApiError(400, "VALIDATION_FAILED", "This task is not an ownership transfer");
  if (!UUID_RE.test(toIdentityId) || toIdentityId === task.identityId) throw new ApiError(400, "VALIDATION_FAILED", "toIdentityId: choose another person");
  const supabase = await supabaseServer();
  const { data: people, error } = await supabase
    .from("identities")
    .select("id, identity_type, status, user_id, display_name")
    .eq("tenant_id", tenantId)
    .in("id", [task.identityId, toIdentityId]);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const from = people?.find((p) => p.id === task.identityId);
  const to = people?.find((p) => p.id === toIdentityId);
  if (!from || !to) throw new ApiError(404, "NOT_FOUND", "No such person in this organization");
  if (to.identity_type !== "HUMAN" || to.status !== "active") throw new ApiError(400, "VALIDATION_FAILED", "toIdentityId: the new owner must be an active person");

  // Agents first: they need a sign-in account on the receiving side.
  let agentsMoved = 0;
  if (from.user_id) {
    const { data: agentRows, error: agentError } = await supabase
      .from("agent_owners")
      .select("id, agent_id, owner_type")
      .eq("tenant_id", tenantId)
      .eq("user_id", from.user_id as string)
      .is("removed_at", null)
      .neq("owner_type", "delegated_owner");
    if (agentError) throw new ApiError(500, "QUERY_FAILED", agentError.message);
    if (agentRows?.length && !to.user_id) {
      throw new ApiError(400, "VALIDATION_FAILED", `This person owns ${agentRows.length} AI agent${agentRows.length > 1 ? "s" : ""}; choose a new owner who can sign in`);
    }
    for (const a of agentRows ?? []) {
      await assignOwner(tenantId, a.agent_id as string, a.owner_type as Parameters<typeof assignOwner>[2], to.user_id as string, actorId);
      await removeOwner(tenantId, a.agent_id as string, a.id as string, actorId);
      agentsMoved++;
    }
  }

  const now = new Date().toISOString();
  const moved = { ownedIdentities: 0, sponsoredIdentities: 0, directReports: 0 };
  for (const [column, key] of [
    ["owner_identity_id", "ownedIdentities"],
    ["sponsor_identity_id", "sponsoredIdentities"],
    ["manager_identity_id", "directReports"],
  ] as const) {
    const { data, error: moveError } = await supabase
      .from("identities")
      .update({ [column]: toIdentityId, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq(column, task.identityId)
      .neq("id", toIdentityId)
      .select("id");
    if (moveError) throw new ApiError(500, "UPDATE_FAILED", moveError.message);
    moved[key] = data?.length ?? 0;
  }

  // Current "owns"/"sponsors"/"manager_of" edges move too; history stays.
  const { data: edges, error: edgeError } = await supabase
    .from("identity_relationships")
    .select("id, target_identity_id, relationship_type")
    .eq("tenant_id", tenantId)
    .eq("source_identity_id", task.identityId)
    .in("relationship_type", ["owns", "sponsors", "manager_of"])
    .is("valid_to", null);
  if (edgeError) throw new ApiError(500, "QUERY_FAILED", edgeError.message);
  for (const e of edges ?? []) {
    await supabase.from("identity_relationships").update({ valid_to: now }).eq("tenant_id", tenantId).eq("id", e.id as string).is("valid_to", null);
    if (e.target_identity_id === toIdentityId) continue;
    const { error: insertError } = await supabase.from("identity_relationships").insert({
      tenant_id: tenantId,
      source_identity_id: toIdentityId,
      target_identity_id: e.target_identity_id,
      relationship_type: e.relationship_type,
      source: "ownership_transfer",
      created_by: actorId,
    });
    if (insertError && insertError.code !== "23505") throw new ApiError(500, "WRITE_FAILED", insertError.message);
  }

  const summary = { ...moved, relationshipsMoved: edges?.length ?? 0, ownedAgents: agentsMoved, toIdentityId };
  await closeTask(tenantId, actorId, task, "done", `Transferred to ${to.display_name}`, summary);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "identity.ownership_transferred",
    objectType: "identity",
    objectId: task.identityId,
    outcome: "success",
    metadata: summary,
  });
  return summary;
}
