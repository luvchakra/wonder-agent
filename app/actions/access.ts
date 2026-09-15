"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addPolicyException,
  addPolicyRule,
  createApplication,
  createEntitlement,
  createManualAccessGrant,
  createPolicy,
  decideAccessRequest,
  evaluatePolicies,
  revokeException,
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
  await createApplication(ctx.tenantId!, String(formData.get("name") ?? ""), String(formData.get("category") ?? "") || undefined);
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
