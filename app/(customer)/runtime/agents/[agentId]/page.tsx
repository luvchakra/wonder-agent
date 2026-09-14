import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRuntimeEvents, getDid, compareShouldCanDid } from "@/modules/runtime-assurance/service";
import { getAgent } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ComparisonOutcomeType } from "@/lib/shared/types/runtime";
import { submitRuntimeEventAction } from "@/app/actions/runtime";
import {
  Badge,
  type BadgeTone,
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
  SelectField,
  TextField,
} from "@/modules/ui";
import { RuntimeEventEvidenceTrigger, RuntimeEventEvidenceDrawer } from "./RuntimeEventEvidenceDrawer";

const OUTCOME_TONE: Record<ComparisonOutcomeType, BadgeTone> = {
  healthy: "success",
  excessive_access: "danger",
  unexpected_capability: "danger",
  behavioral_violation: "danger",
  insufficient_access: "warning",
  unused_capability: "warning",
  unscored_unknown: "neutral",
};

/** Agent Detail — Runtime (DID) tab, including the SHOULD/CAN/DID comparison
 * that is central to CLAUDE.md §9's canonical model. Runtime Agent owns the
 * comparison logic itself; Experience Agent only composes it — see
 * EXPERIENCE-P0-03. */
export default async function AgentRuntimePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("runtime.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const agent = await getAgent(ctx.tenantId!, agentId);
  if (!agent) redirect("/agents");

  const [eventsPage, did, comparison] = await Promise.all([
    listRuntimeEvents(ctx.tenantId!, { agentId, limit: 20 }),
    getDid(ctx.tenantId!, agentId),
    compareShouldCanDid(ctx.tenantId!, agentId),
  ]);

  const submitWithId = submitRuntimeEventAction.bind(null, agentId);
  const overallHealthy = comparison.outcomes.length > 0 && comparison.outcomes.every((o) => o.type === "healthy");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{agent.agentName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Runtime Assurance — what this agent actually DID, and how it compares to SHOULD and CAN.</p>
      </div>

      <AgentTabs agentId={agentId} active="runtime" />

      <Suspense fallback={null}>
        <RuntimeEventEvidenceDrawer events={eventsPage.events} />
      </Suspense>

      <Card>
        <CardHeader
          title="SHOULD vs CAN vs DID"
          description="The canonical comparison: approved purpose vs. technical capability vs. observed behavior (CLAUDE.md §9)."
          actions={comparison.shouldUnknown ? <Badge tone="warning">SHOULD undefined</Badge> : <Badge tone={overallHealthy ? "success" : "danger"}>{overallHealthy ? "Healthy" : "Deviation detected"}</Badge>}
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SHOULD</p>
              <p className="mt-1 text-sm text-foreground">
                {comparison.should.map((s) => `${s.application}${s.data ? `:${s.data}` : ""}`).join(", ") || "(none)"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">CAN</p>
              <p className="mt-1 text-sm text-foreground">
                {comparison.can.map((c) => `${c.application}${c.entitlementName ? `:${c.entitlementName}` : ""}`).join(", ") || "(none)"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">DID</p>
              <p className="mt-1 text-sm text-foreground">
                {comparison.did.map((d) => `${d.application ?? "?"}${d.resource ? `:${d.resource}` : ""}`).join(", ") || "(none)"}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outcomes</p>
            {comparison.outcomes.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No comparison outcomes yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {comparison.outcomes.map((o, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Badge tone={OUTCOME_TONE[o.type]}>{o.type.replace(/_/g, " ")}</Badge>
                    <pre className="flex-1 overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(o.evidence, null, 2)}</pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="DID — Observed Activity" description="Aggregated runtime activity, last 90 days." />
        <CardBody>
          {did.tuples.length === 0 ? (
            <EmptyState title="No runtime activity recorded yet" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Application</Th>
                  <Th>Resource</Th>
                  <Th>Action</Th>
                  <Th>Data classification</Th>
                  <Th>Count</Th>
                </tr>
              </Thead>
              <tbody>
                {did.tuples.map((t, i) => (
                  <Tr key={i}>
                    <Td>{t.application ?? "?"}</Td>
                    <Td>{t.resource ?? "?"}</Td>
                    <Td>{t.action}</Td>
                    <Td>{t.dataClassification ?? "—"}</Td>
                    <Td>{t.eventCount}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Submit test runtime event" description="For demonstration/testing only — production events arrive via MCP/REST/webhook ingestion." />
        <CardBody>
          <form action={submitWithId} className="flex flex-wrap items-end gap-2">
            <SelectField label="Source" name="source" defaultValue="rest">
              <option value="mcp">mcp</option>
              <option value="rest">rest</option>
              <option value="webhook">webhook</option>
            </SelectField>
            <TextField label="Application" name="application" placeholder="e.g. Snowflake" />
            <TextField label="Resource" name="resource" placeholder="e.g. CustomerDB" />
            <TextField label="Action" name="action" placeholder="e.g. read" defaultValue="read" />
            <TextField label="Data classification" name="dataClassification" placeholder="e.g. PII" />
            <Button type="submit" variant="secondary">
              Submit event
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent Events" />
        <CardBody>
          {eventsPage.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Source</Th>
                  <Th>Application / Resource</Th>
                  <Th>Action</Th>
                  <Th>Data classification</Th>
                  <Th>Evidence</Th>
                </tr>
              </Thead>
              <tbody>
                {eventsPage.events.map((e) => (
                  <Tr key={e.id}>
                    <Td>{e.eventTime}</Td>
                    <Td>
                      <Badge tone="neutral">{e.source}</Badge>
                    </Td>
                    <Td>
                      {e.application ?? "?"}/{e.resource ?? "?"}
                    </Td>
                    <Td>{e.action}</Td>
                    <Td>{e.dataClassification ?? "—"}</Td>
                    <Td>
                      <RuntimeEventEvidenceTrigger eventId={e.id} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
