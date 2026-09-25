"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addPolicyException,
  addPolicyRule,
  createApplication,
  createDataSource,
  createEntitlement,
  createManualAccessGrant,
  createPolicy,
  decideAccessRequest,
  evaluatePolicies,
  linkEntitlementToDataSource,
  revokeException,
  updateDataSource,
  validateDataSourceInput,
} from "@/modules/access-governance/service";
import type {
  AccessRequestStatus,
  GrantType,
  PolicyAction,
  PolicyCategory,
  PolicyRuleType,
} from "@/lib/shared/types/access-governance";

export async function createApplicationAction(formData: FormData) {
  const ctx = await requirePermission("access.manage");
  await createApplication(
    ctx.tenantId!,
    String(formData.get("name") ?? ""),
    String(formData.get("category") ?? "") || undefined,
    undefined,
    formData.get("isExternal") === "on",
  );
  redirect("/access");
}

export async function createEntitlementAction(applicationId: string, formData: FormData) {
  const ctx = await requirePermission("access.manage");
  await createEntitlement(
    ctx.tenantId!,
    applicationId,
    String(formData.get("name") ?? ""),
    String(formData.get("dataClassification") ?? "") || undefined,
  );
  redirect("/access");
}

export async function createManualGrantAction(agentId: string, formData: FormData) {
  const ctx = await requirePermission("access.manage");
  await createManualAccessGrant(
    ctx.tenantId!,
    ctx.userId,
    String(formData.get("accountId")),
    String(formData.get("entitlementId")),
    formData.get("grantType") as GrantType,
  );
  redirect(`/access/agents/${agentId}`);
}

export async function evaluateAgentAction(agentId: string) {
  const ctx = await requirePermission("access.read");
  await evaluatePolicies(ctx.tenantId!, agentId);
  redirect(`/access/agents/${agentId}`);
}

export async function decideAccessRequestAction(requestId: string, formData: FormData) {
  const ctx = await requirePermission("access.approve");
  await decideAccessRequest(ctx.tenantId!, ctx.userId, requestId, formData.get("decision") as AccessRequestStatus);
  redirect("/access/requests");
}

export async function createPolicyAction(formData: FormData) {
  const ctx = await requirePermission("policy.create");
  const policy = await createPolicy(ctx.tenantId!, {
    name: String(formData.get("name") ?? ""),
    policyCategory: formData.get("policyCategory") as PolicyCategory,
    action: formData.get("action") as PolicyAction,
  });
  redirect(`/policies/${policy.id}`);
}

export async function addPolicyRuleAction(policyId: string, formData: FormData) {
  await requirePermission("policy.update");
  const condition = JSON.parse(String(formData.get("condition") ?? "{}"));
  await addPolicyRule(policyId, formData.get("ruleType") as PolicyRuleType, condition);
  redirect(`/policies/${policyId}`);
}

// ACCESS-P0-07 — policy_exceptions is now the canonical governance
// exception model; this action stays the policy-scoped entry point.
export async function addPolicyExceptionAction(policyId: string, formData: FormData) {
  const ctx = await requirePermission("policy.update");
  await addPolicyException(ctx.tenantId!, policyId, ctx.userId, {
    reason: String(formData.get("reason") ?? ""),
    agentId: String(formData.get("agentId") ?? "") || undefined,
    expiresAt: String(formData.get("expiresAt") ?? "") || undefined,
    businessJustification: String(formData.get("businessJustification") ?? "") || undefined,
    compensatingControl: String(formData.get("compensatingControl") ?? "") || undefined,
    residualRisk: (formData.get("residualRisk") as "low" | "medium" | "high" | "critical" | null) || undefined,
  });
  redirect(`/policies/${policyId}`);
}

export async function revokeExceptionAction(policyId: string, exceptionId: string) {
  const ctx = await requirePermission("policy.update");
  await revokeException(ctx.tenantId!, ctx.userId, exceptionId);
  redirect(`/policies/${policyId}`);
}

/**
 * ACCESS-P0-13 — data sources. These return a state for the form to show
 * (the real result or the real error) instead of redirecting, so a
 * rejected input is never presented as saved (§17.5).
 */
export type DataSourceFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function formError(err: unknown): DataSourceFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

export async function createDataSourceAction(_prev: DataSourceFormState, formData: FormData): Promise<DataSourceFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    const input = validateDataSourceInput({
      name: formData.get("name"),
      kind: formData.get("kind"),
      applicationId: formData.get("applicationId") || null,
      classification: formData.get("classification"),
      owner: formData.get("owner"),
      description: formData.get("description"),
    });
    const created = await createDataSource(ctx.tenantId!, ctx.userId, input);
    revalidatePath("/access/data-sources");
    return { status: "saved", message: `Added ${created.name}.` };
  } catch (err) {
    return formError(err);
  }
}

export async function linkEntitlementDataSourceAction(_prev: DataSourceFormState, formData: FormData): Promise<DataSourceFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    const entitlementId = String(formData.get("entitlementId") ?? "");
    const dataSourceId = String(formData.get("dataSourceId") ?? "");
    if (!entitlementId || !dataSourceId) return { status: "error", message: "Choose an entitlement and a data source." };
    await linkEntitlementToDataSource(ctx.tenantId!, ctx.userId, entitlementId, dataSourceId);
    revalidatePath("/access/data-sources");
    return { status: "saved", message: "Linked." };
  } catch (err) {
    return formError(err);
  }
}

export async function reclassifyDataSourceAction(dataSourceId: string, _prev: DataSourceFormState, formData: FormData): Promise<DataSourceFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    await updateDataSource(ctx.tenantId!, ctx.userId, dataSourceId, { classification: String(formData.get("classification") ?? "") || null });
    revalidatePath("/access/data-sources");
    return { status: "saved", message: "Saved." };
  } catch (err) {
    return formError(err);
  }
}
