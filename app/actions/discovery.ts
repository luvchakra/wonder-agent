"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { decideDiscovery, discoverFromIntegration, submitDiscovery, type DiscoveryDecision } from "@/modules/integrations/service";

/**
 * INTEGRATION-P0-10 — application discovery forms. The real outcome or
 * error is returned (§17.5); the tenant comes from the session (#2).
 */
export type DiscoveryFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function formError(err: unknown): DiscoveryFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : undefined;
};

export async function discoverFromIntegrationAction(_prev: DiscoveryFormState, formData: FormData): Promise<DiscoveryFormState> {
  const ctx = await requirePermission("integration.update");
  try {
    const r = await discoverFromIntegration(ctx.tenantId!, ctx.userId, str(formData, "integrationId"));
    revalidatePath("/integrations/discovery");
    return { status: "saved", message: `Read ${r.found} application(s): ${r.created} new (${r.matched} matched to the catalog, ${r.unrecognized} unrecognized), ${r.seenAgain} seen before${r.skipped ? `, ${r.skipped} without a name skipped` : ""}.` };
  } catch (err) {
    return formError(err);
  }
}

export async function submitDiscoveryAction(_prev: DiscoveryFormState, formData: FormData): Promise<DiscoveryFormState> {
  const ctx = await requirePermission("integration.update");
  let id: string;
  try {
    const input: Record<string, unknown> = {};
    for (const k of ["kind", "document", "name", "baseUrl", "metadata", "vendor", "url", "description"]) {
      const v = str(formData, k);
      if (v !== undefined) input[k] = v;
    }
    id = (await submitDiscovery(ctx.tenantId!, ctx.userId, input)).discovery.id;
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/integrations/discovery");
  redirect(`/integrations/discovery/${id}`);
}

export async function decideDiscoveryAction(discoveryId: string, _prev: DiscoveryFormState, formData: FormData): Promise<DiscoveryFormState> {
  const action = str(formData, "action") as DiscoveryDecision["action"];
  const ctx = await requirePermission("integration.update");
  try {
    if (action === "register" || action === "link") await requirePermission("access.manage");
    const application: Record<string, unknown> = {};
    for (const k of ["name", "appType", "businessOwnerIdentityId", "technicalOwnerIdentityId", "riskLevel", "dataClassification", "environment"]) {
      const v = str(formData, k);
      if (v !== undefined && v !== "") application[k] = v;
    }
    const d = await decideDiscovery(ctx.tenantId!, ctx.userId, discoveryId, {
      action,
      note: str(formData, "note"),
      applicationId: str(formData, "applicationId"),
      exceptionUntil: str(formData, "exceptionUntil"),
      application,
      connect: formData.get("connect") === "on",
    });
    revalidatePath(`/integrations/discovery/${discoveryId}`);
    revalidatePath("/integrations/discovery");
    revalidatePath("/access");
    const said = { REGISTERED: "Registered in the catalog.", MATCHED: "Linked to the application.", EXCEPTION: "Recorded as an exception.", IGNORED: "Ignored. It stays on record.", UNRECOGNIZED: "Reopened." } as const;
    return { status: "saved", message: said[d.status] };
  } catch (err) {
    return formError(err);
  }
}
