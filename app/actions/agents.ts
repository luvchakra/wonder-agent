"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addRelationship,
  assignOwner,
  createAgent,
  createContractVersion,
  linkAgentIdentity,
  transitionAgentLifecycle,
} from "@/modules/agent-identity/service";
import type {
  AgentCriticality,
  AgentEnvironment,
  AgentIdentityType,
  AgentLifecycleState,
  AgentOwnerType,
  AgentRelationshipType,
} from "@/lib/shared/types/agent-identity";

export async function createAgentAction(formData: FormData) {
  const ctx = await requirePermission("agent.create");
  const agent = await createAgent(ctx.tenantId!, ctx.userId, {
    agentName: String(formData.get("agentName") ?? ""),
    agentType: String(formData.get("agentType") ?? ""),
    purpose: String(formData.get("purpose") ?? "") || undefined,
    agentFramework: String(formData.get("agentFramework") ?? "") || undefined,
    modelProvider: String(formData.get("modelProvider") ?? "") || undefined,
    modelName: String(formData.get("modelName") ?? "") || undefined,
    runtime: String(formData.get("runtime") ?? "") || undefined,
    environment: (formData.get("environment") as AgentEnvironment) || undefined,
    criticality: (formData.get("criticality") as AgentCriticality) || undefined,
    dataClassification: String(formData.get("dataClassification") ?? "") || undefined,
  });
  redirect(`/agents/${agent.id}`);
}

export async function assignOwnerAction(agentId: string, formData: FormData) {
  const ctx = await requirePermission("agent.update");
  await assignOwner(
    ctx.tenantId!,
    agentId,
    formData.get("ownerType") as AgentOwnerType,
    String(formData.get("userId")),
    ctx.userId,
  );
  redirect(`/agents/${agentId}`);
}

export async function transitionLifecycleAction(agentId: string, formData: FormData) {
  const ctx = await requirePermission("agent.update");
  await transitionAgentLifecycle(
    ctx.tenantId!,
    agentId,
    formData.get("toState") as AgentLifecycleState,
    String(formData.get("reason") ?? ""),
    { actorType: "user", actorId: ctx.userId, roles: ctx.roles },
  );
  redirect(`/agents/${agentId}`);
}

export async function createContractAction(agentId: string, formData: FormData) {
  const ctx = await requirePermission("agent.update");
  const listField = (name: string) =>
    String(formData.get(name) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  await createContractVersion(ctx.tenantId!, agentId, ctx.userId, {
    purpose: String(formData.get("purpose") ?? ""),
    ownerSummary: String(formData.get("ownerSummary") ?? "") || undefined,
    approvedApplications: listField("approvedApplications"),
    approvedData: listField("approvedData"),
    prohibitedData: listField("prohibitedData"),
    approvedActions: listField("approvedActions"),
    prohibitedActions: listField("prohibitedActions"),
  });
  redirect(`/agents/${agentId}`);
}

export async function addRelationshipAction(agentId: string, formData: FormData) {
  const ctx = await requirePermission("agent.update");
  await addRelationship(
    ctx.tenantId!,
    agentId,
    String(formData.get("relatedAgentId")),
    formData.get("relationshipType") as AgentRelationshipType,
  );
  redirect(`/agents/${agentId}`);
}

export async function linkIdentityAction(agentId: string, formData: FormData) {
  const ctx = await requirePermission("agent.update");
  await linkAgentIdentity(
    ctx.tenantId!,
    agentId,
    formData.get("identityType") as AgentIdentityType,
    String(formData.get("externalReference")),
    String(formData.get("sourceSystem") ?? "manual"),
  );
  redirect(`/agents/${agentId}`);
}
