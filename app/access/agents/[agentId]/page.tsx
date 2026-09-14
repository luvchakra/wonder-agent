import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  listAccountsForAgent,
  getEffectiveAccess,
  listPolicyEvaluations,
} from "@/modules/access-governance/service";
import { getAgent } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { createManualGrantAction, evaluateAgentAction } from "@/app/actions/access";

const GRANT_TYPES = [
  "direct", "inherited", "group", "role", "delegated",
  "token_scope", "oauth_scope", "api_scope", "mcp_tool_permission", "service_account_relationship",
] as const;

// Bare functional screen — Experience Agent (Module 08) owns visual design.
export default async function AgentAccessPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const agent = await getAgent(ctx.tenantId!, agentId);
  if (!agent) redirect("/agents");

  const [effectiveAccess, accounts, evaluations] = await Promise.all([
    getEffectiveAccess(ctx.tenantId!, agentId),
    listAccountsForAgent(ctx.tenantId!, agentId),
    listPolicyEvaluations(ctx.tenantId!, agentId),
  ]);

  const createGrantWithId = createManualGrantAction.bind(null, agentId);
  const evaluateWithId = evaluateAgentAction.bind(null, agentId);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href={`/agents/${agentId}`}>← {agent.agentName}</Link>
      </p>
      <h1>Effective Access (CAN)</h1>
      <ul>
        {effectiveAccess.map((g) => (
          <li key={g.id}>
            [{g.grantType}] {g.application}: {g.entitlementName}
            {g.dataClassification ? ` (${g.dataClassification})` : ""}
          </li>
        ))}
      </ul>
      {effectiveAccess.length === 0 && <p>No effective access recorded yet.</p>}

      <h2>Add manual grant</h2>
      <form action={createGrantWithId}>
        <select name="accountId">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.externalAccountRef}
            </option>
          ))}
        </select>
        <input name="entitlementId" placeholder="entitlement id (uuid)" required />
        <select name="grantType" defaultValue="direct">
          {GRANT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit">Grant</button>
      </form>

      <h2>Policy Evaluation</h2>
      <form action={evaluateWithId}>
        <button type="submit">Run evaluation now</button>
      </form>
      <ul>
        {evaluations.map((e) => (
          <li key={e.id}>
            {e.evaluatedAt}: {e.result} — {JSON.stringify(e.evidence)}
          </li>
        ))}
      </ul>
    </main>
  );
}
