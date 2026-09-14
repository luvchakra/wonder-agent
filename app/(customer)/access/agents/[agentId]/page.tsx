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
import {
  Badge,
  Card,
  CardHeader,
  CardBody,
  Button,
  AgentTabs,
  EmptyState,
  TableContainer,
  Thead,
  Th,
  Td,
  Tr,
} from "@/modules/ui";

const GRANT_TYPES = [
  "direct", "inherited", "group", "role", "delegated",
  "token_scope", "oauth_scope", "api_scope", "mcp_tool_permission", "service_account_relationship",
] as const;

const inputClass =
  "block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const labelClass = "block text-sm font-medium text-muted-foreground";

/** Agent Detail — Access (CAN) tab. Owned data-fetch stays Access Agent's
 * own service contract; Experience Agent only composes it — see
 * EXPERIENCE-P0-03 and docs/design/ownership-map.md. */
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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{agent.agentName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Effective access — what this agent CAN technically do, derived from IAM data.</p>
      </div>

      <AgentTabs agentId={agentId} active="access" />

      <Card>
        <CardHeader title="Effective Access (CAN)" description={`${effectiveAccess.length} grant${effectiveAccess.length === 1 ? "" : "s"}`} />
        <CardBody>
          {effectiveAccess.length === 0 ? (
            <EmptyState title="No effective access recorded yet" description="This agent has no grants derived from any connected system or manual entry." />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Grant type</Th>
                  <Th>Application</Th>
                  <Th>Entitlement</Th>
                  <Th>Data classification</Th>
                </tr>
              </Thead>
              <tbody>
                {effectiveAccess.map((g) => (
                  <Tr key={g.id}>
                    <Td>
                      <Badge tone="neutral">{g.grantType}</Badge>
                    </Td>
                    <Td>{g.application}</Td>
                    <Td>{g.entitlementName}</Td>
                    <Td>{g.dataClassification ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Add manual grant" />
        <CardBody>
          <form action={createGrantWithId} className="flex flex-wrap items-end gap-2">
            <div>
              <label className={labelClass}>Account</label>
              <select name="accountId" className={inputClass}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.externalAccountRef}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[12rem]">
              <label className={labelClass}>Entitlement ID</label>
              <input name="entitlementId" placeholder="entitlement id (uuid)" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Grant type</label>
              <select name="grantType" defaultValue="direct" className={inputClass}>
                {GRANT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary">
              Grant
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Policy Evaluation"
          description="Deterministic policy checks against this agent's effective access — never an LLM decision (non-negotiable #9)."
          actions={
            <form action={evaluateWithId}>
              <Button type="submit" variant="secondary">
                Run evaluation now
              </Button>
            </form>
          }
        />
        <CardBody>
          {evaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evaluations recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {evaluations.map((e) => (
                <li key={e.id} className="border-b border-border pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{e.evaluatedAt}</span>
                    <Badge tone={e.result === "pass" ? "success" : e.result === "violation" ? "danger" : "warning"}>{e.result}</Badge>
                  </div>
                  <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(e.evidence, null, 2)}</pre>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
