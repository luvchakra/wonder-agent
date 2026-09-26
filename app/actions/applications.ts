"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { registerApplication, updateApplication } from "@/modules/access-governance/service";

/**
 * ACCESS-P0-15 — application catalog forms. The real result or error is
 * returned (§17.5); registering redirects to the application once it
 * exists. The tenant comes from the session (#2).
 */
export type ApplicationFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

const FIELDS = [
  "name",
  "displayName",
  "description",
  "category",
  "appType",
  "vendor",
  "url",
  "businessOwnerIdentityId",
  "technicalOwnerIdentityId",
  "environment",
  "riskLevel",
  "criticality",
  "dataClassification",
] as const;

function fields(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (formData.has(k)) out[k] = String(formData.get(k) ?? "");
  if (formData.has("isExternalPresent")) out.isExternal = formData.get("isExternal") === "on";
  return out;
}

function formError(err: unknown): ApplicationFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

export async function registerApplicationAction(_prev: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  const ctx = await requirePermission("access.manage");
  let id: string;
  try {
    id = (await registerApplication(ctx.tenantId!, ctx.userId, fields(formData))).id;
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/access");
  redirect(`/access/applications/${id}`);
}

export async function updateApplicationAction(applicationId: string, _prev: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    await updateApplication(ctx.tenantId!, ctx.userId, applicationId, fields(formData));
  } catch (err) {
    return formError(err);
  }
  revalidatePath(`/access/applications/${applicationId}`);
  revalidatePath("/access");
  return { status: "saved", message: "Saved." };
}
