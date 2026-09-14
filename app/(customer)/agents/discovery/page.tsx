import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { buildDiscoveryInbox } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { DiscoveryCategory } from "@/lib/shared/types/agent-identity";

const CATEGORY_LABEL: Record<DiscoveryCategory, string> = {
  new: "New — not yet registered",
  likely_duplicate: "Likely duplicate of an existing agent",
  orphaned_identity: "Orphaned — no live owning agent",
};

// IDENTITY-P0-05 — bare functional discovery inbox reconciling Integration
// Agent's imported identity objects against Identity's own agents/
// agent_identities. Experience Agent (Module 08) owns visual design.
export default async function DiscoveryInboxPage() {
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const entries = await buildDiscoveryInbox(ctx.tenantId!);

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Discovery inbox</h1>
      <p>
        Identities observed through configured integrations, reconciled against
        already-registered agents. Nothing here is fabricated — an empty list means
        either no integrations are configured yet, or every discovered identity is
        already correlated to a live agent.
      </p>
      {entries.length === 0 ? (
        <p>Nothing to review.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Name</th>
              <th>Source</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.integrationId}-${e.externalId}`} style={{ borderBottom: "1px solid #eee" }}>
                <td>{e.displayName}</td>
                <td>{e.sourceSystem}</td>
                <td>{CATEGORY_LABEL[e.category]}</td>
                <td>
                  {e.category === "likely_duplicate" && e.likelyDuplicateOfAgentId ? (
                    <Link href={`/agents/${e.likelyDuplicateOfAgentId}`}>View matched agent</Link>
                  ) : e.category === "new" ? (
                    <Link href="/agents/new">Register</Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        <Link href="/agents">← Back to agents</Link>
      </p>
    </main>
  );
}
