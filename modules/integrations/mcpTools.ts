import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { createConnector } from "./registry";
import { openGateway } from "./gateway/gateway";
import { getDecryptedCredential } from "./credentials";
import { toIntegrationObject } from "./mappers";
import type { IntegrationObject } from "@/lib/shared/types/integrations";
import type { ResourceKind } from "./framework/types";

/**
 * INTEGRATION-P0-04.1, extended by INTEGRATION-P0-06, now run by the
 * connector framework's mcp driver (non-negotiable #20). Reads an MCP
 * connection's server identity, declared tools and resources (read-only:
 * nothing is executed) and stores them as the integration_objects families
 * `mcp_server`, `mcp_tool` and `mcp_resource`.
 *
 * `runtime_tools` (Runtime) is a different concept: tools an agent was
 * observed invoking (DID). This is what a server declares it offers.
 *
 * Tool -> agent association is deliberately NOT implemented here: the
 * link is Identity's (linkAgentIdentity, identityType 'mcp_server').
 *
 * The server record is written first, so every tool and resource of this
 * discovery is at least as new as it; `getMcpInventory()` uses that to
 * mark anything older as no longer declared.
 */
const MCP_KINDS: ResourceKind[] = ["mcp_server", "mcp_tool", "mcp_resource"];

export async function discoverMcpTools(tenantId: string, integrationId: string): Promise<IntegrationObject[]> {
  const supabase = await supabaseServer();
  const { data: integration, error } = await supabase
    .from("integrations")
    .select()
    .eq("id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!integration) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  // Discovery's requests pass the connection's Connector Gateway session, flushed when it ends.
  const gateway = openGateway({ tenantId, integrationId, status: integration.status });
  const connector = createConnector(integration.integration_type_id, gateway);
  await connector.authenticate(integration.config ?? {}, await getDecryptedCredential(tenantId, integrationId));
  const kinds = connector.kinds().filter((k) => MCP_KINDS.includes(k));
  if (!kinds.includes("mcp_server")) throw new ApiError(400, "INVALID_INPUT", "Not an MCP connection");

  const admin = supabaseServiceRole();
  const rows: Record<string, unknown>[] = [];
  try {
    for (const kind of kinds) {
      const records = await connector.importKind(kind);
      const now = new Date().toISOString();
      for (const r of records) {
        const { data, error: upsertError } = await admin
          .from("integration_objects")
          .upsert(
            { tenant_id: tenantId, integration_id: integrationId, object_type: kind, external_id: r.externalId, raw: r.raw, normalized: r.normalized ?? {}, imported_at: now },
            { onConflict: "integration_id,object_type,external_id" },
          )
          .select()
          .single();
        if (upsertError) throw new ApiError(500, "CREATE_FAILED", upsertError.message);
        rows.push(data);
      }
    }
  } finally {
    await connector.close();
    await gateway.flush();
  }
  return rows.map(toIntegrationObject);
}
