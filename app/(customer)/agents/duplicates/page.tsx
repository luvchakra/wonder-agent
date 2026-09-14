import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listDuplicateCandidates } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { confirmDistinctAction, mergeDuplicateCandidateAction } from "@/app/actions/agents";

// IDENTITY-P0-04 — bare functional review inbox. Experience Agent (Module
// 08) owns visual design.
export default async function DuplicateCandidatesPage() {
  let ctx;
  try {
    ctx = await requirePermission("agent.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const candidates = await listDuplicateCandidates(ctx.tenantId!, "pending");

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Duplicate registration review</h1>
      <p>
        A pending registration matched an existing agent above the duplicate-match
        threshold. Confirm they really are the same agent (merge — the pending
        registration is discarded) or that they are genuinely distinct (confirm —
        registration completes now).
      </p>
      {candidates.length === 0 ? (
        <p>No pending duplicate candidates.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Candidate name</th>
              <th>Matched agent</th>
              <th>Score</th>
              <th>Matched on</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>{String((c.candidateData as { agentName?: string }).agentName ?? "(unknown)")}</td>
                <td>
                  <Link href={`/agents/${c.matchedAgentId}`}>{c.matchedAgentId}</Link>
                </td>
                <td>{c.matchScore}</td>
                <td>{c.matchedKeys.join(", ")}</td>
                <td>
                  <form action={mergeDuplicateCandidateAction} style={{ display: "inline" }}>
                    <input type="hidden" name="candidateId" value={c.id} />
                    <button type="submit">Merge (same agent)</button>
                  </form>{" "}
                  <form action={confirmDistinctAction} style={{ display: "inline" }}>
                    <input type="hidden" name="candidateId" value={c.id} />
                    <button type="submit">Confirm distinct</button>
                  </form>
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
