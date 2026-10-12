"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError, type TenantContext } from "@/lib/shared/types/foundation";
import {
  approveAutomationCredential,
  approveAutomationCredentialExtension,
  assignAutomationCredentialRole,
  createAutomationCredential,
  removeAutomationCredentialRole,
  requestAutomationCredentialExtension,
  revokeAutomationCredential,
  rotateAutomationCredential,
} from "@/lib/security/automationCredentials";

/**
 * FOUNDATION-P0-31 — Admin › Automation credentials. Tenant and actor come
 * from the session; every action needs automation.manage and the service
 * enforces four-eyes, escalation and audit. A secret is returned to the
 * page once and never again.
 */

export type AutomationActionState = { ok: boolean; message: string | null; secret?: string };

const PATH = "/settings/automation";

async function run(work: (ctx: TenantContext) => Promise<string | { message: string; secret: string }>): Promise<AutomationActionState> {
  try {
    const ctx = await requirePermission("automation.manage");
    const result = await work(ctx);
    revalidatePath(PATH);
    return typeof result === "string" ? { ok: true, message: result } : { ok: true, message: result.message, secret: result.secret };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, message: err.status === 403 && err.code === "FORBIDDEN" ? "You don't have permission to manage automation credentials." : err.message };
    throw err;
  }
}

const id = (formData: FormData) => String(formData.get("id") ?? "");

export async function createAutomationCredentialAction(_prev: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  return run(async (ctx) => {
    const { credential, secret } = await createAutomationCredential(ctx.tenantId!, { userId: ctx.userId, permissions: ctx.permissions }, {
      name: formData.get("name"),
      identityId: formData.get("identityId"),
      roles: formData.getAll("roles"),
      expiresInDays: formData.get("expiresInDays"),
      allowedCidrs: formData.get("allowedCidrs"),
      rateLimitPerMinute: formData.get("rateLimitPerMinute"),
    });
    return { message: `${credential.name} was created. It works once another administrator approves it. Copy the secret now; it is not shown again.`, secret };
  });
}

export async function approveAutomationCredentialAction(_prev: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  return run(async (ctx) => {
    await approveAutomationCredential(ctx.tenantId!, ctx.userId, id(formData));
    return "Approved. The credential works now.";
  });
}

export async function requestExtensionAction(_prev: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  return run(async (ctx) => {
    await requestAutomationCredentialExtension(ctx.tenantId!, ctx.userId, id(formData), formData.get("days"));
    return "Extension requested. Another administrator must approve it.";
  });
}

export async function approveExtensionAction(_prev: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  return run(async (ctx) => {
    await approveAutomationCredentialExtension(ctx.tenantId!, ctx.userId, id(formData));
    return "Extension approved.";
  });
}

export async function revokeAutomationCredentialAction(_prev: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  return run(async (ctx) => {
    await revokeAutomationCredential(ctx.tenantId!, ctx.userId, id(formData), formData.get("reason"));
    return "Revoked. It stopped working immediately.";
  });
}

export async function rotateAutomationCredentialAction(_prev: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  return run(async (ctx) => {
    const { secret } = await rotateAutomationCredential(ctx.tenantId!, ctx.userId, id(formData));
    return { message: "New secret issued; the old one stopped working. Copy it now; it is not shown again.", secret };
  });
}

export async function credentialRoleAction(_prev: AutomationActionState, formData: FormData): Promise<AutomationActionState> {
  return run(async (ctx) => {
    const role = String(formData.get("role") ?? "");
    if (!role) throw new ApiError(400, "VALIDATION", "Choose a role");
    if (formData.get("op") === "remove") {
      await removeAutomationCredentialRole(ctx.tenantId!, ctx.userId, id(formData), role);
      return "Role removed.";
    }
    await assignAutomationCredentialRole(ctx.tenantId!, { userId: ctx.userId, permissions: ctx.permissions }, id(formData), role);
    return "Role given.";
  });
}
