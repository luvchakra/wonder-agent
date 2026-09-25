import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { createConnector } from "./registry";
import { getDecryptedCredential } from "./credentials";
import { toIntegrationObject } from "./mappers";
import type { IntegrationObject } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-04.1, extended by INTEGRATION-P0-06. Discovers an MCP
 * server's identity, declared tools and resources (read-only: nothing is
 * executed) and persists them as the integration_objects families
 * `mcp_server`, `mcp_tool` and `mcp_resource`. Tools used to be stored as
 * the generic `entitlement`; migration 0069 reclassified any such rows.
 *
 * `runtime_tools` (Runtime) is a different concept: tools an agent was
 * observed invoking (DID). This is what a server declares it offers.
 *
 * Tool -> agent association is deliberately NOT implemented here: the
 * link is Identity's (linkAgentIdentity, identityType 'mcp_server'). A
 * second link mutation here would duplicate a write path Identity owns.
 *
 * The server record is written first, so every tool and resource of this
 * discovery is at least as new as it; `getMcpInventory()` uses that to
 * mark anything older as no longer declared.
 */
export async function discoverMcpTools(
  tenantId: string,
  integrationId: string,
): Promise<IntegrationObject[]> {
  const supabase = await supabaseServer();
  const { data: integration, error } = await supabase
    .from("integrations")
    .select()
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!integration) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  if (integration.integration_type_id !== "mcp") {
    throw new ApiError(400, "INVALID_INPUT", "Not an MCP integration");
  }

  const secret = await getDecryptedCredential(tenantId, integrationId);
  const connector = createConnector("mcp");
  await connector.authenticate(integration.config ?? {}, secret);
  const tools = (await connector.discover?.()) ?? [];

  const admin = supabaseServiceRole();
  const rows = [];
  // Server first (see above).
  const ordered = [...tools.filter((t) => t.objectType === "mcp_server"), ...tools.filter((t) => t.objectType !== "mcp_server")];
  for (const tool of ordered) {
    const { data, error: upsertError } = await admin
      .from("integration_objects")
      .upsert(
        {
          tenant_id: tenantId,
          integration_id: integrationId,
          object_type: tool.objectType,
          external_id: tool.externalRef,
          raw: tool.summary,
          normalized: tool.summary,
          imported_at: new Date().toISOString(),
        },
        { onConflict: "integration_id,object_type,external_id" },
      )
      .select()
      .single();
    if (upsertError) throw new ApiError(500, "CREATE_FAILED", upsertError.message);
    rows.push(data);
  }

  return rows.map(toIntegrationObject);
}
