"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addRelationship,
  assignOwner,
  confirmDistinctAndRegister,
  createAgent,
  createContractVersion,
  linkAgentIdentity,
  mergeDuplicateCandidate,
  recordDiscoveryDecision,
  transitionAgentLifecycle,
  type IdentityConfidence,
} from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
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
  const result = await createAgent(ctx.tenantId!, ctx.userId, {
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
  // IDENTITY-P0-04 — a likely-duplicate registration is diverted to the
  // review inbox instead of completing immediately.
  if (result.kind === "duplicate_candidate") {
    redirect(`/agents/duplicates?highlight=${result.candidate.id}`);
  }
  redirect(`/agents/${result.agent.id}`);
}

export async function mergeDuplicateCandidateAction(formData: FormData) {
  const ctx = await requirePermission("agent.create");
  const candidateId = String(formData.get("candidateId") ?? "");
  await mergeDuplicateCandidate(ctx.tenantId!, ctx.userId, candidateId);
  redirect("/agents/duplicates");
}

export async function confirmDistinctAction(formData: FormData) {
  const ctx = await requirePermission("agent.create");
  const candidateId = String(formData.get("candidateId") ?? "");
  const agent = await confirmDistinctAndRegister(ctx.tenantId!, ctx.userId, candidateId);
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

  const autonomyLevelRaw = String(formData.get("autonomyLevel") ?? "");

  await createContractVersion(ctx.tenantId!, agentId, ctx.userId, {
    purpose: String(formData.get("purpose") ?? ""),
    ownerSummary: String(formData.get("ownerSummary") ?? "") || undefined,
    approvedApplications: listField("approvedApplications"),
    approvedData: listField("approvedData"),
    prohibitedData: listField("prohibitedData"),
    approvedActions: listField("approvedActions"),
    prohibitedActions: listField("prohibitedActions"),
    autonomyLevel: autonomyLevelRaw ? (Number(autonomyLevelRaw) as 0 | 1 | 2 | 3 | 4) : undefined,
    allowedTools: listField("allowedTools"),
    actionsRequiringApproval: listField("actionsRequiringApproval"),
    requiredMonitoring: String(formData.get("requiredMonitoring") ?? "") || undefined,
    requiredComplianceControls: listField("requiredComplianceControls"),
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
    {
      actorId: ctx.userId,
      confidence: (String(formData.get("confidence") ?? "unverified") as IdentityConfidence),
      basis: "Linked manually on the agent page",
    },
  );
  redirect(`/agents/${agentId}`);
}

/**
 * Agent Discovery — registers a candidate as a governed WonderAgent Agent
 * Identity. Reuses the existing registration + lifecycle services end to
 * end (createAgent's own duplicate check, linkAgentIdentity for source
 * evidence, assignOwner, and the existing DISCOVERED -> REGISTERED
 * transition with its already-enforced purpose/source/owner prerequisites
 * — lifecycle.ts's validateTransition()) rather than a second registration
 * state machine (spec §23/§52 rule 2). Registration never grants or
 * revokes IAM access (non-negotiable — nothing here calls out to an
 * integration's write path at all).
 */
export async function registerDiscoveryCandidateAction(formData: FormData) {
  const ctx = await requirePermission("agent.create");
  const sourceSystem = String(formData.get("sourceSystem") ?? "");
  const sourceObjectId = String(formData.get("sourceObjectId") ?? "");
  const identityType = (formData.get("identityType") as AgentIdentityType) || "service_account";
  const businessOwnerUserId = String(formData.get("businessOwnerUserId") ?? "").trim();
  const technicalOwnerUserId = String(formData.get("technicalOwnerUserId") ?? "").trim();

  const result = await createAgent(ctx.tenantId!, ctx.userId, {
    agentName: String(formData.get("agentName") ?? ""),
    agentType: String(formData.get("agentType") ?? ""),
    purpose: String(formData.get("purpose") ?? "") || undefined,
    environment: (formData.get("environment") as AgentEnvironment) || undefined,
    sourceSystem,
    sourceObjectId,
  });

  // IDENTITY-P0-04's existing duplicate-registration check may have
  // diverted this into the review inbox instead of creating a new agent.
  if (result.kind === "duplicate_candidate") {
    redirect(`/agents/duplicates?highlight=${result.candidate.id}`);
  }

  const agent = result.agent;
  // A person reviewed this candidate's evidence and registered it.
  await linkAgentIdentity(ctx.tenantId!, agent.id, identityType, sourceObjectId, sourceSystem, {
    actorId: ctx.userId,
    confidence: "confirmed",
    basis: `Registered from discovery candidate ${sourceSystem}::${sourceObjectId}`,
  });

  if (businessOwnerUserId) {
    await assignOwner(ctx.tenantId!, agent.id, "business_owner", businessOwnerUserId, ctx.userId);
  }
  if (technicalOwnerUserId) {
    await assignOwner(ctx.tenantId!, agent.id, "technical_owner", technicalOwnerUserId, ctx.userId);
  }

  // If an owner prerequisite is still missing, the transition simply
  // doesn't happen yet — the agent stays DISCOVERED and the agent detail
  // page's existing ownership-issue surfacing (getOwnershipIssues) makes
  // that visible (AC-007), rather than failing registration outright.
  try {
    await transitionAgentLifecycle(ctx.tenantId!, agent.id, "REGISTERED", "Registered from Agent Discovery", {
      actorType: "user",
      actorId: ctx.userId,
      roles: ctx.roles,
    });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 412)) throw err;
  }

  redirect(`/agents/${agent.id}`);
}

/** Agent Discovery — reviewer marks a candidate as not worth tracking. */
export async function ignoreDiscoveryCandidateAction(formData: FormData) {
  const ctx = await requirePermission("agent.create");
  await recordDiscoveryDecision(ctx.tenantId!, ctx.userId, {
    sourceSystem: String(formData.get("sourceSystem") ?? ""),
    sourceObjectId: String(formData.get("sourceObjectId") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    decisionType: "ignored",
  });
  redirect("/agents/discovery");
}

/** Agent Discovery — reviewer correlates a candidate to a specific existing agent (spec §15 LINK_EXISTING). */
export async function linkDiscoveryCandidateAction(formData: FormData) {
  const ctx = await requirePermission("agent.create");
  const matchedAgentId = String(formData.get("matchedAgentId") ?? "").trim();
  if (!matchedAgentId) throw new ApiError(400, "INVALID_INPUT", "matchedAgentId is required");

  await recordDiscoveryDecision(ctx.tenantId!, ctx.userId, {
    sourceSystem: String(formData.get("sourceSystem") ?? ""),
    sourceObjectId: String(formData.get("sourceObjectId") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    decisionType: "linked",
    matchedAgentId,
    identityType: (formData.get("identityType") as AgentIdentityType) || undefined,
  });
  redirect(`/agents/${matchedAgentId}`);
}
