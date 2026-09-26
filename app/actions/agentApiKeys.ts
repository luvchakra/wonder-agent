"use server";

import { revalidatePath } from "next/cache";
import { requireAnyPermissionFor, requirePermissionFor } from "@/lib/rbac/authorize";
import { agentResource } from "@/app/_shared/agentScope";
import { createAgentApiKey, revokeAgentApiKey } from "@/lib/security/agentApiKeys";
import { ApiError } from "@/lib/shared/types/foundation";

// FOUNDATION-P0-17 — the Agent 360 "API keys" card's server actions. The
// permission checks live here, server-side; the card only hides controls
// the user could not use anyway.

export type CreateAgentKeyState =
  | { status: "idle" }
  | { status: "created"; secret: string; name: string }
  | { status: "error"; message: string };

export async function createAgentApiKeyAction(
  agentId: string,
  _prev: CreateAgentKeyState,
  formData: FormData,
): Promise<CreateAgentKeyState> {
  try {
    const ctx = await requirePermissionFor("agent.update", agentResource(agentId));
    const expiry = String(formData.get("expiresOn") ?? "").trim();
    const { key, secret } = await createAgentApiKey(ctx.tenantId!, ctx.userId, agentId, {
      name: String(formData.get("name") ?? ""),
      // A date input gives YYYY-MM-DD; the key expires at the end of that day (UTC).
      expiresAt: expiry ? `${expiry}T23:59:59Z` : null,
    });
    revalidatePath(`/agents/${agentId}`);
    return { status: "created", secret, name: key.name };
  } catch (err) {
    if (err instanceof ApiError) return { status: "error", message: err.message };
    throw err;
  }
}

export async function revokeAgentApiKeyAction(
  agentId: string,
  keyId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireAnyPermissionFor(["agent.update", "runtime.emergency"], agentResource(agentId));
    await revokeAgentApiKey(ctx.tenantId!, ctx.userId, agentId, keyId, reason);
    revalidatePath(`/agents/${agentId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof ApiError) return { success: false, error: err.message };
    throw err;
  }
}
