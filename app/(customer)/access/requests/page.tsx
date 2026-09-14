import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAccessRequests } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { decideAccessRequestAction } from "@/app/actions/access";

// Bare functional screen — Experience Agent (Module 08) owns visual design.
export default async function AccessRequestsPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const requests = await listAccessRequests(ctx.tenantId!);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/access">← Applications</Link>
      </p>
      <h1>Access Requests</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Agent</th>
            <th>Justification</th>
            <th>Status</th>
            <th>Decide</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const decideWithId = decideAccessRequestAction.bind(null, r.id);
            return (
              <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>{r.agentId}</td>
                <td>{r.justification}</td>
                <td>{r.status}</td>
                <td>
                  {r.status === "pending" && (
                    <form action={decideWithId} style={{ display: "inline" }}>
                      <button type="submit" name="decision" value="approved">
                        Approve
                      </button>
                      <button type="submit" name="decision" value="rejected">
                        Reject
                      </button>
                    </form>
                  )}
                  {r.status === "approved" && (
                    <form action={decideWithId} style={{ display: "inline" }}>
                      <button type="submit" name="decision" value="fulfilled">
                        Mark fulfilled
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
