"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { resolveRef } from "@/lib/refs/objectRef";
import { ApiError } from "@/lib/shared/types/foundation";
import { upgradeConnection } from "@/modules/integrations/framework/catalog";
import { createSyncJob, discoverMcpTools, resolveHeldMissing, runSyncJob, startConnectorSignIn, testIntegrationConnection } from "@/modules/integrations/service";

/** FOUNDATION-P0-34: a connection's page is addressed by its number. */
async function connectionPath(tenantId: string, integrationId: string): Promise<string> {
  const found = await resolveRef(tenantId, "integrations", integrationId);
  return `/integrations/${found?.ref ?? integrationId}`;
}

export async function testConnectionAction(integrationId: string) {
  const ctx = await requirePermission("integration.execute");
  await testIntegrationConnection(ctx.tenantId!, integrationId);
  redirect(await connectionPath(ctx.tenantId!, integrationId));
}

export async function triggerSyncAction(integrationId: string) {
  const ctx = await requirePermission("integration.execute");
  const job = await createSyncJob(ctx.tenantId!, integrationId, "manual");
  // Server actions don't have next/server's request-scoped after(); run the
  // (already fire-and-forget by design) sync without awaiting so this
  // action still returns promptly.
  void runSyncJob(ctx.tenantId!, job.id);
  redirect(await connectionPath(ctx.tenantId!, integrationId));
}

/**
 * INTEGRATION-P0-21 — "Connect" on a sign-in-with-the-provider connection:
 * sets the httpOnly cookie only the connection's callback receives, then
 * sends the browser to the provider's own sign-in page. A server action
 * redirect is a script navigation, so the CSP form-action allow-list (which
 * names hosted payment pages only) does not need every provider added.
 */
export async function connectSignInAction(integrationId: string) {
  const ctx = await requirePermission("integration.update");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`;
  let location: string;
  try {
    const started = await startConnectorSignIn(ctx.tenantId!, ctx.userId, integrationId, origin);
    (await cookies()).set(started.cookie.name, started.cookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: started.cookie.secure,
      path: started.cookie.path,
      maxAge: started.cookie.maxAge,
    });
    location = started.location;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status === 404) throw err;
    location = `${await connectionPath(ctx.tenantId!, integrationId)}?oauth=${err.code === "CREDENTIALS_REQUIRED" ? "needs_credentials" : "failed"}`;
  }
  redirect(location);
}

/**
 * INTEGRATION-P0-21 — moves a connection to another version of its type.
 * A refusal (something blocks it) returns to the preview with the reason.
 */
export async function upgradeConnectionAction(integrationId: string, version: string) {
  const ctx = await requirePermission("integration.update");
  const page = await connectionPath(ctx.tenantId!, integrationId);
  let target = `${page}?upgraded=${encodeURIComponent(version)}`;
  try {
    await upgradeConnection(ctx.tenantId!, ctx.userId, integrationId, version);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status === 404) throw err;
    target = `${page}/upgrade?version=${encodeURIComponent(version)}&failed=1`;
  }
  redirect(target);
}

/**
 * INTEGRATION-P0-18 — approve or discard a sync the mass-missing guard
 * held. The page shows the real outcome: the job's new status, or why the
 * decision was refused (already decided, or a newer run has started).
 */
export async function resolveHeldMissingAction(integrationId: string, jobId: string, decision: "approve" | "discard") {
  const ctx = await requirePermission("integration.update");
  let outcome: string;
  try {
    await resolveHeldMissing(ctx.tenantId!, ctx.userId, integrationId, jobId, decision);
    outcome = decision === "approve" ? "approved" : "discarded";
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    outcome = err.code === "SUPERSEDED" ? "superseded" : err.code === "NOT_HELD" ? "decided" : "failed";
  }
  redirect(`${await connectionPath(ctx.tenantId!, integrationId)}?held=${outcome}`);
}

/**
 * INTEGRATION-P0-06 — re-reads an MCP server's declarations (read-only:
 * no tool is called). Returns a truthful result for the button to show;
 * a failure is reported, never swallowed (§17.5).
 */
export type DiscoverMcpState = { status: "idle" } | { status: "done"; tools: number; resources: number } | { status: "error"; message: string };

export async function discoverMcpAction(integrationId: string): Promise<DiscoverMcpState> {
  const ctx = await requirePermission("integration.execute");
  try {
    const objects = await discoverMcpTools(ctx.tenantId!, integrationId);
    revalidatePath("/integrations/mcp");
    return {
      status: "done",
      tools: objects.filter((o) => o.objectType === "mcp_tool").length,
      resources: objects.filter((o) => o.objectType === "mcp_resource").length,
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message.slice(0, 200) : "Discovery failed" };
  }
}
