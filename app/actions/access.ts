"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addPolicyRule,
  createApplication,
  createEntitlement,
  createManualAccessGrant,
  createPolicy,
  decideAccessRequest,
  evaluatePolicies,
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
