"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createSyncJob, discoverMcpTools, runSyncJob, testIntegrationConnection } from "@/modules/integrations/service";

export async function testConnectionAction(integrationId: string) {
  const ctx = await requirePermission("integration.execute");
  await testIntegrationConnection(ctx.tenantId!, integrationId);
  redirect(`/integrations/${integrationId}`);
}

export async function triggerSyncAction(integrationId: string) {
  const ctx = await requirePermission("integration.execute");
  const job = await createSyncJob(ctx.tenantId!, integrationId, "manual");
  // Server actions don't have next/server's request-scoped after(); run the
  // (already fire-and-forget by design) sync without awaiting so this
  // action still returns promptly.
  void runSyncJob(ctx.tenantId!, job.id);
  redirect(`/integrations/${integrationId}`);
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
