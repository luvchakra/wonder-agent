import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AccessGraph, AccessGraphEdge, AccessGraphNode } from "@/lib/shared/types/access-governance";
import { getEffectiveAccess } from "./grants";

type AccountRow = {
  id: string;
  external_account_ref: string;
  application_id: string;
  applications: { id: string; name: string } | null;
};

/**
 * ACCESS-P0-03 — Access Graph. A *view* over the same canonical
 * relationships getEffectiveAccess()/explainAccessPath() already compute —
 * deliberately not a materialized/stored graph (ACCESS-P0-01.1's original
 * decision not to build an `access_paths` table stands; see that story's
 * own documented gap). Returns both a node/edge graph (for Experience
 * Agent's graph visualization) and the same flat AccessGrant[] rows (for
 * any non-graph UI consumer), covering every GrantType this module models
 * (direct, inherited, group, role, delegated, token/OAuth/API scope, MCP
 * tool permission, service-account relationship).
 */
export async function getAccessGraph(tenantId: string, agentId: string): Promise<AccessGraph> {
  const rows = await getEffectiveAccess(tenantId, agentId);

  const supabase = await supabaseServer();
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, external_account_ref, application_id, applications(id, name)")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .returns<AccountRow[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));

  const nodes = new Map<string, AccessGraphNode>();
  const edges: AccessGraphEdge[] = [];

  const agentNodeId = `agent:${agentId}`;
  nodes.set(agentNodeId, { id: agentNodeId, type: "agent", label: agentId });

  for (const account of accounts ?? []) {
    const accountNodeId = `account:${account.id}`;
    nodes.set(accountNodeId, {
      id: accountNodeId,
      type: "account",
      label: account.external_account_ref,
      data: { applicationId: account.application_id },
    });
    edges.push({ source: agentNodeId, target: accountNodeId, relation: "has_account" });

    if (account.applications) {
      const appNodeId = `application:${account.applications.id}`;
      nodes.set(appNodeId, { id: appNodeId, type: "application", label: account.applications.name });
      edges.push({ source: accountNodeId, target: appNodeId, relation: "belongs_to" });
    }
  }

  for (const row of rows) {
    const account = accountById.get(row.accountId);
    if (!account) continue;
    const accountNodeId = `account:${account.id}`;
    const entitlementNodeId = `entitlement:${row.entitlementId}`;
    nodes.set(entitlementNodeId, {
      id: entitlementNodeId,
      type: "entitlement",
      label: row.entitlementName ?? row.entitlementId,
      data: { application: row.application, dataClassification: row.dataClassification },
    });
    edges.push({ source: accountNodeId, target: entitlementNodeId, relation: row.grantType });
  }

  return { agentId, nodes: [...nodes.values()], edges, rows };
}
