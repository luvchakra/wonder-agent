import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { notify } from "@/modules/operations/service";
import { answerRefusal, askRefusal } from "./consultationRules";

/**
 * COMPLIANCE-P0-14 part 3 — consultation. The item's reviewer asks a member
 * a question; the member answers once, from /compliance/consultations/<id>.
 * The reviewer still decides. Questions and answers are kept with the item
 * as evidence; the audit trail keeps only their fingerprints (typed text,
 * WID-H07). Writes with the service role, filtered by tenant (§14).
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Consultation = { id: string; itemId: string; askedBy: string; askedOf: string; question: string; answer: string | null; answeredAt: string | null; createdAt: string };

function toConsultation(r: Row): Consultation {
  return {
    id: r.id as string,
    itemId: r.item_id as string,
    askedBy: r.asked_by as string,
    askedOf: r.asked_of as string,
    question: r.question as string,
    answer: (r.answer as string | null) ?? null,
    answeredAt: (r.answered_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** An active person in the organization (never an automation credential), by user id or email. */
async function memberUserId(tenantId: string, who: { userId?: unknown; email?: unknown }): Promise<string | null> {
  const admin = supabaseServiceRole();
  let userId = typeof who.userId === "string" && UUID_RE.test(who.userId) ? who.userId : null;
  if (!userId && typeof who.email === "string" && who.email.trim()) {
    const { data } = await admin.from("users").select("id").eq("email", who.email.trim().toLowerCase()).maybeSingle();
    userId = (data?.id as string | undefined) ?? null;
  }
  if (!userId) return null;
  const { data: m } = await admin.from("tenant_memberships").select("tenant_id, status, account_type").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  return m && m.tenant_id === tenantId && m.status === "active" && m.account_type !== "automation" ? userId : null;
}

export async function askConsultation(tenantId: string, actorId: string, itemId: string, input: { askedOfUserId?: unknown; askedOfEmail?: unknown; question?: unknown }): Promise<Consultation> {
  if (!UUID_RE.test(itemId)) throw new ApiError(404, "ITEM_NOT_FOUND");
  const admin = supabaseServiceRole();
  const { data: item, error } = await admin.from("certification_items").select("id, tenant_id, reviewer_id, status, snapshot").eq("tenant_id", tenantId).eq("id", itemId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!item || item.tenant_id !== tenantId) throw new ApiError(404, "ITEM_NOT_FOUND");
  const askedOf = await memberUserId(tenantId, { userId: input.askedOfUserId, email: input.askedOfEmail });
  const refusal = askRefusal({ reviewerId: item.reviewer_id as string, actorId, itemStatus: item.status as string, askedOf, question: input.question });
  if (refusal) throw new ApiError(refusal.status, refusal.code, refusal.error);
  const question = (input.question as string).trim();
  const { data, error: insertError } = await admin
    .from("certification_consultations")
    .insert({ tenant_id: tenantId, item_id: itemId, asked_by: actorId, asked_of: askedOf, question, created_by: actorId })
    .select("*")
    .single();
  if (insertError || !data) throw new ApiError(500, "WRITE_FAILED", insertError?.message ?? "Could not save");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.consultation_requested", objectType: "certification_item", objectId: itemId, outcome: "success", metadata: { consultationId: data.id, askedOf }, typedText: { question } });
  const snap = (item.snapshot as { person?: { displayName?: string }; role?: { displayName?: string }; accessGrant?: { application?: string } | null } | null) ?? {};
  const about = [snap.person?.displayName, snap.role?.displayName ?? snap.accessGrant?.application].filter(Boolean).join(" · ");
  await notify({
    tenantId,
    userId: askedOf,
    type: "certification_due",
    title: "An access review asks for your input",
    body: `${about ? `${about}. ` : ""}Answer at /compliance/consultations/${data.id as string}`,
    referenceType: "certification_consultation",
    referenceId: data.id as string,
  });
  return toConsultation(data);
}

export async function answerConsultation(tenantId: string, actorId: string, consultationId: string, answer: unknown): Promise<Consultation> {
  if (!UUID_RE.test(consultationId)) throw new ApiError(404, "NOT_FOUND", "No such question");
  const admin = supabaseServiceRole();
  const { data: row, error } = await admin.from("certification_consultations").select("*").eq("tenant_id", tenantId).eq("id", consultationId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row || row.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such question");
  const refusal = answerRefusal({ askedOf: row.asked_of as string, actorId, answeredAt: (row.answered_at as string | null) ?? null, answer });
  if (refusal) throw new ApiError(refusal.status, refusal.code, refusal.error);
  const text = (answer as string).trim();
  const { data, error: updateError } = await admin
    .from("certification_consultations")
    .update({ answer: text, answered_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", consultationId)
    .is("answered_at", null)
    .select("*")
    .maybeSingle();
  if (updateError) throw new ApiError(500, "WRITE_FAILED", updateError.message);
  if (!data) throw new ApiError(409, "ALREADY_ANSWERED", "Already answered");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.consultation_answered", objectType: "certification_item", objectId: row.item_id as string, outcome: "success", metadata: { consultationId }, typedText: { answer: text } });
  await notify({ tenantId, userId: row.asked_by as string, type: "certification_due", title: "Your question on an access review was answered", body: "Open the campaign to see the answer and decide.", referenceType: "certification_consultation", referenceId: consultationId });
  return toConsultation(data);
}

/** Questions on one item, read as the caller (RLS), filtered by tenant. */
export async function listConsultationsForItem(tenantId: string, itemId: string): Promise<Consultation[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("certification_consultations").select("*").eq("tenant_id", tenantId).eq("item_id", itemId).order("created_at").limit(50);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map(toConsultation);
}

/** For the answer page: the question and what the item is about, only for the person asked. */
export async function getConsultationForAnswer(tenantId: string, actorId: string, consultationId: string): Promise<(Consultation & { about: string }) | null> {
  if (!UUID_RE.test(consultationId)) return null;
  const admin = supabaseServiceRole();
  const { data: row } = await admin.from("certification_consultations").select("*, certification_items(snapshot)").eq("tenant_id", tenantId).eq("id", consultationId).eq("asked_of", actorId).maybeSingle();
  if (!row || row.tenant_id !== tenantId) return null;
  const snap = ((row.certification_items as { snapshot?: Record<string, unknown> } | null)?.snapshot ?? {}) as { person?: { displayName?: string }; role?: { displayName?: string }; accessGrant?: { application?: string; entitlementName?: string } | null };
  const about = [snap.person?.displayName, snap.role?.displayName ?? [snap.accessGrant?.application, snap.accessGrant?.entitlementName].filter(Boolean).join(" · ")].filter(Boolean).join(": ");
  return { ...toConsultation(row as Row), about };
}
