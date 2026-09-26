"use server";

import { revalidatePath } from "next/cache";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/requirePermission";
import type { AccessRequestStatus } from "@/lib/shared/types/access-governance";
import { cancelAccessRequest, decideAccessRequest, decideApprovalStep, saveRequestPolicy, submitAccessRequest } from "@/modules/access-governance/service";

/**
 * ACCESS-P0-18 — request catalog forms. Each returns the real outcome
 * (§17.5): approved at once, waiting for approval, an existing request
 * returned, or why it was refused. The tenant comes from the session (#2).
 */
export type RequestFormState = { status: "idle" } | { status: "saved"; message: string; requestId?: string } | { status: "error"; message: string };

function formError(err: unknown): RequestFormState {
  const e = err as { message?: string; code?: string };
  return {
    status: "error",
    message: e?.message || e?.code || "Something went wrong",
  };
}
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v !== "" ? v : undefined;
};

export async function submitRequestAction(applicationId: string, _prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const ctx = await requirePermission("access.request");
  try {
    const { request, duplicate } = await submitAccessRequest(
      ctx.tenantId!,
      {
        userId: ctx.userId,
        canManageAccess: ctx.permissions.includes("access.manage"),
      },
      {
        applicationId,
        entitlementId: str(formData, "entitlementId"),
        subjectIdentityId: str(formData, "subjectIdentityId"),
        durationDays: str(formData, "durationDays"),
        justification: str(formData, "justification") ?? "",
      },
    );
    revalidatePath("/access/requests");
    const message = duplicate
      ? `An identical request is already open (${request.status === "pending" ? "waiting for approval" : "approved"}); it was not submitted twice.`
      : request.status === "approved"
        ? "Approved automatically under the request policy. It is ready to be fulfilled."
        : "Submitted. It is waiting for approval.";
    return { status: "saved", message, requestId: request.id };
  } catch (err) {
    return formError(err);
  }
}

export async function cancelRequestAction(requestId: string, _prev: RequestFormState): Promise<RequestFormState> {
  void _prev;
  const ctx = await requirePermission("access.request");
  try {
    await cancelAccessRequest(ctx.tenantId!, ctx.userId, requestId);
    revalidatePath("/access/requests");
    return { status: "saved", message: "Cancelled." };
  } catch (err) {
    return formError(err);
  }
}

export async function decideRequestAction(requestId: string, catalog: boolean, _prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const ctx = await requireAnyPermission(["access.approve", "access.request", "access.read"]);
  const decision = str(formData, "decision") as AccessRequestStatus;
  try {
    // ACCESS-P0-19: a catalog request is decided one approval step at a time.
    if (catalog && (decision === "approved" || decision === "rejected")) {
      const { request } = await decideApprovalStep(
        ctx.tenantId!,
        {
          userId: ctx.userId,
          roles: ctx.roles,
          canApproveAsAccessManager: ctx.permissions.includes("access.approve"),
        },
        requestId,
        decision,
        str(formData, "comment"),
      );
      revalidatePath("/access/requests");
      revalidatePath(`/access/requests/${requestId}`);
      const message =
        request.status === "approved"
          ? "Approved. That was the last approval: the request is approved."
          : request.status === "rejected"
            ? "Rejected. The request is closed."
            : `Approved your step. It now waits for stage ${request.approvalStage ?? "?"}.`;
      return { status: "saved", message };
    }
    if (!ctx.permissions.includes("access.approve")) return { status: "error", message: "Missing permission: access.approve" };
    const r = await decideAccessRequest(ctx.tenantId!, ctx.userId, requestId, decision);
    revalidatePath("/access/requests");
    revalidatePath(`/access/requests/${requestId}`);
    return {
      status: "saved",
      message: r.status === "fulfilled" ? "Marked fulfilled." : r.status === "approved" ? "Approved." : "Rejected.",
    };
  } catch (err) {
    return formError(err);
  }
}

const POLICY_FIELDS = [
  "name",
  "applicationId",
  "entitlementId",
  "allowForOthers",
  "maxDurationDays",
  "defaultDurationDays",
  "riskThreshold",
  "approval",
  "approvalMode",
  "approvalTimeoutDays",
  "onTimeout",
  "status",
] as const;
const POLICY_FLAGS = ["requestable", "allowSelf", "justificationRequired", "autoApprove"] as const;

export async function savePolicyAction(_prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const ctx = await requirePermission("access.manage");
  const input: Record<string, unknown> = {};
  for (const k of POLICY_FIELDS) if (formData.has(k)) input[k] = String(formData.get(k) ?? "");
  for (const k of POLICY_FLAGS) input[k] = formData.get(k) === "on";
  try {
    const p = await saveRequestPolicy(ctx.tenantId!, ctx.userId, input);
    revalidatePath("/access/request-policies");
    revalidatePath("/access/catalog");
    return { status: "saved", message: `Saved "${p.name}".` };
  } catch (err) {
    return formError(err);
  }
}
