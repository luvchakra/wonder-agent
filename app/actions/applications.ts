"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  configureOnboarding,
  decideOnboarding,
  promoteOnboarding,
  registerApplication,
  setApplicationLifecycle,
  simulateOnboarding,
  startOnboarding,
  updateApplication,
  validateOnboarding,
} from "@/modules/access-governance/service";

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

// ---------------------------------------------------------------- ACCESS-P0-16 onboarding

const CONFIG_FIELDS = [
  "integrationId",
  "accountIdentifierField",
  "correlationAccountField",
  "correlationIdentityField",
  "entitlementSource",
  "requestPolicy",
  "certificationPolicy",
] as const;
const CONFIG_FLAGS = ["createAccount", "updateAccount", "disableAccount", "deleteAccount", "grantAccess", "revokeAccess", "provenanceEnabled"] as const;

function revalidateApplication(applicationId: string) {
  revalidatePath(`/access/applications/${applicationId}/onboarding`);
  revalidatePath(`/access/applications/${applicationId}`);
  revalidatePath("/access");
}

export async function startOnboardingAction(applicationId: string, _prev: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    await startOnboarding(ctx.tenantId!, ctx.userId, applicationId, String(formData.get("mode") ?? "assisted"));
  } catch (err) {
    return formError(err);
  }
  revalidateApplication(applicationId);
  return { status: "saved", message: "Onboarding started." };
}

export async function configureOnboardingAction(applicationId: string, _prev: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  const ctx = await requirePermission("access.manage");
  const config: Record<string, unknown> = {};
  for (const k of CONFIG_FIELDS) if (formData.has(k)) config[k] = String(formData.get(k) ?? "");
  // Unchecked boxes are absent from the form: every flag is set explicitly.
  for (const k of CONFIG_FLAGS) config[k] = formData.get(k) === "on";
  try {
    const before = formData.get("configVersion");
    const after = await configureOnboarding(ctx.tenantId!, ctx.userId, applicationId, config);
    revalidateApplication(applicationId);
    return { status: "saved", message: String(after.configVersion) === before ? "No changes." : `Saved as version ${after.configVersion}.` };
  } catch (err) {
    return formError(err);
  }
}

/** Validate, simulate, approve, reject or promote: the button pressed names the step. */
export async function onboardingStepAction(applicationId: string, _prev: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  const ctx = await requirePermission("access.manage");
  const step = formData.get("step");
  const [tenantId, actorId] = [ctx.tenantId!, ctx.userId];
  let message: string;
  try {
    if (step === "validate") {
      const o = await validateOnboarding(tenantId, actorId, applicationId);
      message = o.status === "FAILED" ? "Validation found blocking problems." : "Validation passed.";
    } else if (step === "simulate") {
      const o = await simulateOnboarding(tenantId, actorId, applicationId);
      message = o.status === "FAILED" ? "The simulation failed." : "The simulation passed and was submitted for approval.";
    } else if (step === "approve" || step === "reject") {
      await decideOnboarding(tenantId, actorId, applicationId, { approve: step === "approve", note: formData.get("note") });
      message = step === "approve" ? "Approved." : "Rejected.";
    } else if (step === "promote") {
      await promoteOnboarding(tenantId, actorId, applicationId);
      message = "Promoted. The application is active.";
    } else {
      return { status: "error", message: "Unknown step" };
    }
  } catch (err) {
    return formError(err);
  }
  revalidateApplication(applicationId);
  return { status: "saved", message };
}

export async function applicationLifecycleAction(applicationId: string, _prev: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  const ctx = await requirePermission("access.manage");
  try {
    const to = await setApplicationLifecycle(ctx.tenantId!, ctx.userId, applicationId, formData.get("lifecycle"), formData.get("note"));
    revalidateApplication(applicationId);
    return { status: "saved", message: `The application is now ${to.toLowerCase()}.` };
  } catch (err) {
    return formError(err);
  }
}
