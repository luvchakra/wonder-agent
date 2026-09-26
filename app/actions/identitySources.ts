"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  createIdentitySource,
  resolvePendingCorrelation,
  startReconciliation,
  updateIdentitySource,
  type CorrelationDecision,
} from "@/modules/integrations/service";

/**
 * INTEGRATION-P0-08/09 — identity source forms. Each returns the real
 * result or error (§17.5). CSV uploads do not come through here (server
 * actions cap request bodies at 1 MB); the upload form posts to
 * /api/v1/integrations/identity-sources/:id/runs instead.
 */
export type SourceFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function formError(err: unknown): SourceFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

function sourceFields(formData: FormData) {
  return {
    name: formData.get("name") ?? undefined,
    template: formData.get("template") ?? undefined,
    integrationId: formData.get("integrationId") || undefined,
    identityType: formData.get("identityType") ?? undefined,
    authoritative: formData.get("authoritative") === "on",
    priority: formData.get("priority") ?? undefined,
    authoritativeFields: formData.getAll("authoritativeFields").map(String),
    attributeMappings: String(formData.get("attributeMappings") ?? "[]"),
    correlationRules: String(formData.get("correlationRules") ?? "[]"),
    leaverStrategy: formData.get("leaverStrategy") ?? undefined,
    leaverThresholdPercent: formData.get("leaverThresholdPercent") ?? undefined,
    status: formData.get("status") ?? undefined,
  };
}

export async function createIdentitySourceAction(_prev: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const ctx = await requirePermission("integration.create");
  let id: string;
  try {
    id = (await createIdentitySource(ctx.tenantId!, ctx.userId, sourceFields(formData))).id;
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/integrations/sources");
  redirect(`/integrations/sources/${id}`);
}

export async function updateIdentitySourceAction(sourceId: string, _prev: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const ctx = await requirePermission("integration.update");
  try {
    const fields = sourceFields(formData);
    await updateIdentitySource(ctx.tenantId!, ctx.userId, sourceId, { ...fields, template: undefined, integrationId: undefined });
  } catch (err) {
    return formError(err);
  }
  revalidatePath(`/integrations/sources/${sourceId}`);
  return { status: "saved", message: "Saved." };
}

/** Reads the linked integration's imported identities; the run continues after the response. */
export async function runIntegrationImportAction(sourceId: string, _prev: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const ctx = await requirePermission("integration.execute");
  let runId: string;
  try {
    const mode = formData.get("mode") === "partial" ? "partial" : "full";
    const { run, execute } = await startReconciliation(ctx.tenantId!, ctx.userId, sourceId, { kind: "integration", mode, dryRun: formData.get("dryRun") === "on" });
    after(execute);
    runId = run.id;
  } catch (err) {
    return formError(err);
  }
  redirect(`/integrations/sources/${sourceId}/runs/${runId}`);
}

export async function resolveCorrelationAction(pendingId: string, decision: CorrelationDecision): Promise<SourceFormState> {
  const ctx = await requirePermission("identity.manage");
  try {
    const r = await resolvePendingCorrelation(ctx.tenantId!, ctx.userId, pendingId, decision);
    revalidatePath("/integrations/correlations");
    return { status: "saved", message: r.status === "dismissed" ? "Dismissed." : r.status === "created" ? "New identity created." : "Linked." };
  } catch (err) {
    return formError(err);
  }
}
