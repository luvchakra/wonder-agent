"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { createAuthorizationPolicy, deleteAuthorizationPolicy, setAuthorizationPolicyStatus, updateAuthorizationPolicy } from "@/lib/rbac/authorizationPolicies";

/**
 * FOUNDATION-P0-19 — the Authorization policies screens' server actions.
 * Writing a policy is tenant security configuration
 * (tenant.security.manage); the service validates, the database enforces
 * the lockout rule again, and every change is audited.
 */

export type PolicyActionState = { ok: boolean; message: string | null; errors?: Record<string, string> };

function refused(err: unknown): PolicyActionState {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  throw err;
}

function inputFrom(formData: FormData) {
  const prefixes = String(formData.get("prefixes") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  return {
    name: formData.get("name"),
    description: formData.get("description"),
    effect: formData.get("effect"),
    permissions: [...formData.getAll("permissions").map(String), ...prefixes],
    scopeType: formData.get("scopeType") ?? "tenant",
    scopeValues: formData.getAll("scopeValues").map(String),
    exemptRoleIds: formData.getAll("exemptRoleIds").map(String),
  };
}

export async function savePolicyAction(_prev: PolicyActionState, formData: FormData): Promise<PolicyActionState> {
  const id = String(formData.get("policyId") ?? "");
  let result;
  try {
    const ctx = await requirePermission("tenant.security.manage");
    result = id ? await updateAuthorizationPolicy(ctx.tenantId!, ctx.userId, id, inputFrom(formData)) : await createAuthorizationPolicy(ctx.tenantId!, ctx.userId, inputFrom(formData));
  } catch (err) {
    return refused(err);
  }
  if (!result.ok) return { ok: false, message: "Check the highlighted fields.", errors: result.errors };
  revalidatePath("/settings/authorization-policies");
  if (id) return { ok: true, message: "Saved. It applies from the next request." };
  redirect(`/settings/authorization-policies/${result.id}?created=1`);
}

export async function setPolicyStatusAction(_prev: PolicyActionState, formData: FormData): Promise<PolicyActionState> {
  const id = String(formData.get("policyId") ?? "");
  const status = formData.get("status") === "active" ? "active" : "inactive";
  try {
    const ctx = await requirePermission("tenant.security.manage");
    await setAuthorizationPolicyStatus(ctx.tenantId!, ctx.userId, id, status);
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/authorization-policies");
  revalidatePath(`/settings/authorization-policies/${id}`);
  return { ok: true, message: status === "active" ? "Activated. It applies from the next request." : "Deactivated. It no longer applies." };
}

export async function deletePolicyAction(_prev: PolicyActionState, formData: FormData): Promise<PolicyActionState> {
  const id = String(formData.get("policyId") ?? "");
  try {
    const ctx = await requirePermission("tenant.security.manage");
    await deleteAuthorizationPolicy(ctx.tenantId!, ctx.userId, id);
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/authorization-policies");
  redirect("/settings/authorization-policies?deleted=1");
}
