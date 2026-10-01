"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  advanceRequest,
  closeBreach,
  createBreach,
  createMyRequest,
  createRequest,
  grantMyConsent,
  placeLegalHold,
  releaseLegalHold,
  saveConsentPurpose,
  savePrivacySettings,
  saveProcessingActivity,
  saveRetentionPolicy,
  setProcessingActivityStatus,
  updateBreach,
  withdrawMyConsent,
  withdrawMyRequest,
  type RequestAction,
} from "@/modules/privacy/service";

/**
 * COMPLIANCE-P0-12 — the privacy screens' server actions. Tenant and actor
 * always come from the session (§14); each staff action checks exactly the
 * permission for what it does. The self-service actions need only an
 * active membership: every member holds their own data rights.
 */

export type PrivacyActionState = { ok: boolean; message: string | null; errors?: Record<string, string> };

function refused(err: unknown): PrivacyActionState {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  throw err;
}

function formObject(formData: FormData, multi: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (multi.includes(k)) out[k] = [...((out[k] as string[]) ?? []), String(v)];
    else out[k] = typeof v === "string" ? v : null;
  }
  return out;
}

async function member() {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) throw new ApiError(401, "NO_TENANT", "No active organization");
  return ctx as typeof ctx & { tenantId: string };
}

const revalidateAdmin = () => revalidatePath("/settings/privacy", "layout");

// ------------------------------------------------------------ staff

export async function savePrivacySettingsAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  try {
    const ctx = await requirePermission("privacy.manage");
    const result = await savePrivacySettings(ctx.tenantId!, ctx.userId, formObject(formData, ["regimes"]));
    if (!result.ok) return { ok: false, message: "Check the highlighted fields.", errors: result.errors };
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  return { ok: true, message: "Privacy contacts saved." };
}

export async function saveProcessingActivityAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  try {
    const ctx = await requirePermission("privacy.manage");
    const raw = formObject(formData);
    const result = await saveProcessingActivity(ctx.tenantId!, ctx.userId, (raw.id as string) || null, raw);
    if (!result.ok) return { ok: false, message: "Check the highlighted fields.", errors: result.errors };
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  return { ok: true, message: "Record of processing saved." };
}

export async function setProcessingActivityStatusAction(id: string, status: "active" | "retired"): Promise<void> {
  const ctx = await requirePermission("privacy.manage");
  await setProcessingActivityStatus(ctx.tenantId!, ctx.userId, id, status);
  revalidateAdmin();
}

export async function saveConsentPurposeAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  try {
    const ctx = await requirePermission("privacy.manage");
    const result = await saveConsentPurpose(ctx.tenantId!, ctx.userId, formObject(formData));
    if (!result.ok) return { ok: false, message: "Check the highlighted fields.", errors: result.errors };
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  return { ok: true, message: "Consent purpose saved." };
}

export async function createRequestAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  let id: string;
  try {
    const ctx = await requirePermission("privacy.requests.process");
    const raw = formObject(formData);
    id = (await createRequest(ctx.tenantId!, ctx.userId, raw as never)).id;
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  redirect(`/settings/privacy/requests/${id}`);
}

export async function advanceRequestAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const action = String(formData.get("action") ?? "");
  const step = {
    action,
    method: String(formData.get("method") ?? ""),
    userId: String(formData.get("userId") ?? ""),
    dueAt: String(formData.get("dueAt") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    note: String(formData.get("note") ?? ""),
    outcome: formData.get("outcome") === "partially_fulfilled" ? "partially_fulfilled" : "fulfilled",
  } as unknown as RequestAction;
  try {
    const ctx = await requirePermission("privacy.requests.process");
    await advanceRequest(ctx.tenantId!, ctx.userId, requestId, step);
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  const done: Record<string, string> = {
    verify: "Identity verification recorded.",
    assign: "Assigned.",
    extend: "Deadline extended. Tell the requester the new date and the reason.",
    submit_for_approval: "Sent for a second person's approval.",
    approve: "Approved; the erasure ran and the request is completed.",
    return_to_processing: "Returned for more work.",
    complete: "Completed. Send the response to the requester.",
    reject: "Refused. Tell the requester why and how to complain to the authority.",
  };
  return { ok: true, message: done[action] ?? "Saved." };
}

export async function saveRetentionPolicyAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  try {
    const ctx = await requirePermission("privacy.manage");
    await saveRetentionPolicy(ctx.tenantId!, ctx.userId, String(formData.get("category") ?? ""), Number(formData.get("days")), formData.get("enabled") === "on");
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  return { ok: true, message: "Retention period saved." };
}

export async function placeLegalHoldAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  try {
    const ctx = await requirePermission("privacy.manage");
    await placeLegalHold(ctx.tenantId!, ctx.userId, { name: formData.get("name"), reason: formData.get("reason"), categories: formData.getAll("categories").map(String) });
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  return { ok: true, message: "Legal hold placed. Retention will not delete the covered data while it is active." };
}

export async function releaseLegalHoldAction(holdId: string): Promise<void> {
  const ctx = await requirePermission("privacy.manage");
  await releaseLegalHold(ctx.tenantId!, ctx.userId, holdId);
  revalidateAdmin();
}

export async function createBreachAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  let id: string;
  try {
    const ctx = await requirePermission("privacy.incidents.manage");
    id = (await createBreach(ctx.tenantId!, ctx.userId, formObject(formData, ["regimes"]))).id;
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  redirect(`/settings/privacy/breaches/${id}`);
}

export async function updateBreachAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  const breachId = String(formData.get("breachId") ?? "");
  try {
    const ctx = await requirePermission("privacy.incidents.manage");
    if (formData.get("intent") === "close") await closeBreach(ctx.tenantId!, ctx.userId, breachId);
    else await updateBreach(ctx.tenantId!, ctx.userId, breachId, formObject(formData));
  } catch (err) {
    return refused(err);
  }
  revalidateAdmin();
  return { ok: true, message: formData.get("intent") === "close" ? "Breach closed." : "Breach record updated." };
}

// ------------------------------------------------------------ self-service

export async function setMyConsentAction(purposeId: string, grant: boolean): Promise<void> {
  const ctx = await member();
  const h = await headers();
  const language = (h.get("accept-language") ?? "en").split(",")[0]?.split(";")[0]?.trim().toLowerCase() || "en";
  if (grant) await grantMyConsent(ctx.tenantId, ctx.userId, purposeId, language, { userAgent: h.get("user-agent") });
  else await withdrawMyConsent(ctx.tenantId, ctx.userId, purposeId);
  revalidatePath("/my-privacy");
}

export async function createMyRequestAction(_p: PrivacyActionState, formData: FormData): Promise<PrivacyActionState> {
  try {
    const ctx = await member();
    const req = await createMyRequest(ctx.tenantId, ctx.userId, formObject(formData) as never);
    revalidatePath("/my-privacy");
    return { ok: true, message: `Request ${req.reference} received. The organization must respond by ${req.dueAt.slice(0, 10)}.` };
  } catch (err) {
    return refused(err);
  }
}

export async function withdrawMyRequestAction(requestId: string): Promise<void> {
  const ctx = await member();
  await withdrawMyRequest(ctx.tenantId, ctx.userId, requestId);
  revalidatePath("/my-privacy");
}
