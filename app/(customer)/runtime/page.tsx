import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { listEmergencyControls, listRuntimeDecisions, listRuntimeEvents } from "@/modules/runtime-assurance/service";
import { EmergencyControlsPanel } from "./EmergencyControlsPanel";
import { ApiError } from "@/lib/shared/types/foundation";
import { ACCESS_VIEW, Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr, type BadgeTone } from "@/modules/ui";
import { RuntimeActivity, type ActivityRow } from "./RuntimeActivity";

const WINDOW_SIZE = 200;

const DECISION_TONE: Record<string, BadgeTone> = {
  ALLOW: "success",
  ALLOW_WITH_RESTRICTIONS: "info",
  REQUIRE_APPROVAL: "warning",
  DENY: "danger",
};
const DECISION_LABEL: Record<string, string> = {
  ALLOW: "Allow",
  ALLOW_WITH_RESTRICTIONS: "Allow, restricted",
  REQUIRE_APPROVAL: "Needs approval",
  DENY: "Deny",
};

// Composition-only view over Runtime Agent's published listRuntimeEvents()
// and Identity's listAgents(), per EXPERIENCE-P0-03 — Runtime Agent owns
// /runtime/agents/:id (the SHOULD/CAN/DID comparison) itself; this is the
// tenant-wide activity stream the supplied design shows, which had no page
// of its own before (the route was a bare list of agent links).
export default async function RuntimeIndexPage() {
  let ctx;
  try {
    ctx = await requirePermission("runtime.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const tenantId = ctx.tenantId!;
  const [agents, page, decisions, controls] = await Promise.all([
    listAgents(tenantId),
    // Server-side limit, per CLAUDE.md §15 — never the whole table.
    listRuntimeEvents(tenantId, { limit: WINDOW_SIZE }),
    // RUNTIME-P0-15 — the gateway's most recent authorization decisions.
    listRuntimeDecisions(tenantId, { limit: 10 }),
    // RUNTIME-P0-18 — active emergency controls.
    listEmergencyControls(tenantId, { activeOnly: true }),
  ]);

  const nameById = new Map(agents.map((a) => [a.id, a.displayName?.trim() || a.agentName]));
  const rows: ActivityRow[] = page.events.map((e) => ({
    id: e.id,
    agentId: e.agentId,
    agentName: nameById.get(e.agentId) ?? "Unknown agent",
    eventTime: e.eventTime,
    source: e.source,
    action: e.action,
    application: e.application,
    resource: e.resource,
    dataClassification: e.dataClassification,
    success: e.success,
    raw: e.raw,
    eventType: e.eventType,
  }));

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Home
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Runtime Assurance</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Runtime activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What your AI agents actually did: {ACCESS_VIEW.did}, compared with {ACCESS_VIEW.should} and {ACCESS_VIEW.can}.
          </p>
        </div>
        <LinkButton href="/reports" variant="outline" size="sm">
          Reports &amp; export
        </LinkButton>
      </div>

      <EmergencyControlsPanel controls={controls} canManage={ctx.permissions.includes("runtime.emergency")} />

      <Card className="min-w-0">
        <CardHeader
          title="Authorization decisions"
          description="The Runtime Gateway's decision on each request an agent made before acting. Observe-only: decisions are recorded, nothing is blocked yet."
        />
        <CardBody className="pt-0">
          {decisions.length === 0 ? (
            <EmptyState
              title="No gateway requests yet"
              description="Agents call POST /api/gateway/v1/authorize with their API key (Agent 360 → API keys) before acting."
            />
          ) : (
            <TableContainer label="Authorization decisions" bare>
              <Thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Agent</Th>
                  <Th>Action</Th>
                  <Th hideBelow="xl">Target</Th>
                  <Th>Decision</Th>
                  <Th hideBelow="lg">Reason</Th>
                </tr>
              </Thead>
              <tbody>
                {decisions.map((d) => (
                  <Tr key={d.decisionId}>
                    <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{d.createdAt.slice(0, 16).replace("T", " ")}</Td>
                    <Td>
                      <Link href={`/agents/${d.agentId}`} className="font-medium text-foreground hover:text-primary">
                        {nameById.get(d.agentId) ?? "Unknown agent"}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{d.action}</Td>
                    <Td hideBelow="xl" className="text-muted-foreground">{[d.application, d.tool ?? d.resource].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={DECISION_TONE[d.decision]}>{DECISION_LABEL[d.decision]}</Badge>
                        {!d.enforced ? <span className="text-xs text-muted-foreground">observed</span> : null}
                      </span>
                    </Td>
                    <Td hideBelow="lg" className="max-w-[28rem] text-muted-foreground">{d.reason}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <RuntimeActivity rows={rows} windowLabel={`most recent ${WINDOW_SIZE}`} />
    </div>
  );
}
