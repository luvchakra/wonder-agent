import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { AgentsTable } from "./AgentsTable";

// EXPERIENCE-P0-08 — first real consumer of the shared DataTable primitive.
// Full visual pass for this screen (EXPERIENCE-P0-03) is still a separate,
// larger, already-flagged story — this only replaces the raw <table>.
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
      <AgentsTable agents={agents} />
      <p>
        <Link href="/">← Back</Link>
      </p>
    </main>
  );
}
