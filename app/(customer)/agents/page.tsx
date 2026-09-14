import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";

// Bare functional list — Experience Agent (Module 08) owns visual design.
export default async function AgentsPage() {
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const agents = await listAgents(ctx.tenantId!);

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>AI Agents</h1>
      <p>
        <Link href="/agents/new">+ Register a new agent</Link>
        {" · "}
        <Link href="/agents/duplicates">Duplicate review</Link>
        {" · "}
        <Link href="/agents/discovery">Discovery inbox</Link>
      </p>
      {agents.length === 0 ? (
        <p>No agents registered yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Name</th>
              <th>Type</th>
              <th>Lifecycle</th>
              <th>Criticality</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>
                  <Link href={`/agents/${a.id}`}>{a.agentName}</Link>
                </td>
                <td>{a.agentType}</td>
                <td>{a.lifecycleState}</td>
                <td>{a.criticality}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        <Link href="/">← Back</Link>
      </p>
    </main>
  );
}
