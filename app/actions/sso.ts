"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createSsoConnection, setSsoConnectionStatus } from "@/lib/auth/sso";

export async function createSsoConnectionAction(formData: FormData) {
  const ctx = await requirePermission("sso.manage");

  const protocol = String(formData.get("protocol") ?? "");
  const domain = String(formData.get("domain") ?? "");
  const entityIdOrIssuer = String(formData.get("entityIdOrIssuer") ?? "");
  const ssoUrl = String(formData.get("ssoUrl") ?? "");
  const certificate = String(formData.get("certificate") ?? "");
  const defaultRole = String(formData.get("defaultRole") ?? "READ_ONLY");

  if (protocol !== "saml" && protocol !== "oidc") {
    throw new Error("protocol must be saml or oidc");
  }

  await createSsoConnection(ctx.tenantId!, ctx.userId, {
    protocol,
    domain,
    defaultRole,
    idpMetadata:
      protocol === "saml"
        ? { entityId: entityIdOrIssuer, ssoUrl, certificate }
        : { issuer: entityIdOrIssuer },
    claimsMapping: {},
  });

  revalidatePath("/settings/sso");
}

export async function setSsoConnectionStatusAction(formData: FormData) {
  const ctx = await requirePermission("sso.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (status !== "active" && status !== "disabled") {
    throw new Error("status must be active or disabled");
  }
  await setSsoConnectionStatus(ctx.tenantId!, ctx.userId, id, status);
  revalidatePath("/settings/sso");
}
