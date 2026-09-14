import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRuntimeEvents, getDid, compareShouldCanDid } from "@/modules/runtime-assurance/service";
import { getAgent } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { submitRuntimeEventAction } from "@/app/actions/runtime";

// Bare functional screen — Experience Agent (Module 08) owns visual design,
// per docs/design/UI-UX-DESIGN-RULES.md. This page is functional scaffolding.
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

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href={`/agents/${agentId}`}>← {agent.agentName}</Link>
      </p>
      <h1>Runtime Assurance</h1>

      <h2>DID — Observed Activity (last 90 days)</h2>
      <ul>
        {did.tuples.map((t, i) => (
          <li key={i}>
            {t.application ?? "?"} / {t.resource ?? "?"} — {t.action}
            {t.dataClassification ? ` (${t.dataClassification})` : ""} × {t.eventCount}
          </li>
        ))}
      </ul>
      {did.tuples.length === 0 && <p>No runtime activity recorded yet.</p>}

      <h2>SHOULD vs CAN vs DID</h2>
      <p>SHOULD: {comparison.should.map((s) => `${s.application}${s.data ? `:${s.data}` : ""}`).join(", ") || "(none)"}</p>
      <p>CAN: {comparison.can.map((c) => `${c.application}${c.entitlementName ? `:${c.entitlementName}` : ""}`).join(", ") || "(none)"}</p>
      <p>DID: {comparison.did.map((d) => `${d.application ?? "?"}${d.resource ? `:${d.resource}` : ""}`).join(", ") || "(none)"}</p>
      <h3>Outcomes</h3>
      <ul>
        {comparison.outcomes.map((o, i) => (
          <li key={i}>
            <strong>{o.type}</strong> — {JSON.stringify(o.evidence)}
          </li>
        ))}
      </ul>

      <h2>Submit test runtime event</h2>
      <form action={submitWithId}>
        <select name="source" defaultValue="rest">
          <option value="mcp">mcp</option>
          <option value="rest">rest</option>
          <option value="webhook">webhook</option>
        </select>
        <input name="application" placeholder="application (e.g. Snowflake)" />
        <input name="resource" placeholder="resource (e.g. CustomerDB)" />
        <input name="action" placeholder="action (e.g. read)" defaultValue="read" />
        <input name="dataClassification" placeholder="data classification (e.g. PII)" />
        <button type="submit">Submit event</button>
      </form>

      <h2>Recent Events</h2>
      <ul>
        {eventsPage.events.map((e) => (
          <li key={e.id}>
            {e.eventTime} [{e.source}] {e.application ?? "?"}/{e.resource ?? "?"} — {e.action}
            {e.dataClassification ? ` (${e.dataClassification})` : ""}
          </li>
        ))}
      </ul>
      {eventsPage.events.length === 0 && <p>No events yet.</p>}
    </main>
  );
}
