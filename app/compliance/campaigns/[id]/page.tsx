import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaignItems } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { recordDecisionAction } from "@/app/actions/compliance";

// Bare functional screen — Experience Agent (Module 08) owns visual design,
// per docs/design/UI-UX-DESIGN-RULES.md. This page is functional scaffolding.
export default async function CampaignItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const items = await listCampaignItems(ctx.tenantId!, campaignId);

  return (
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/compliance/campaigns">← Campaigns</Link>
      </p>
      <h1>Certification Items</h1>

      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Risk</th>
            <th>Usage</th>
            <th>Recommendation</th>
            <th>Status</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const decideWithIds = recordDecisionAction.bind(null, campaignId, item.id);
            return (
              <tr key={item.id}>
                <td>{item.agentId}</td>
                <td>{item.riskAtReview ?? "—"}</td>
                <td>{item.usageAtReview ?? "—"}</td>
                <td>{item.recommendation ?? "—"}</td>
                <td>{item.status}</td>
                <td>
                  {item.status === "pending" && (
                    <form action={decideWithIds}>
                      <select name="decision" defaultValue="approve">
                        <option value="approve">approve</option>
                        <option value="revoke">revoke</option>
                        <option value="modify">modify</option>
                        <option value="delegate">delegate</option>
                        <option value="request_information">request_information</option>
                      </select>
                      <input name="justification" placeholder="justification" required />
                      <input name="delegateToUserId" placeholder="delegate to (uuid, if delegate)" />
                      <button type="submit">Submit</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length === 0 && <p>No items in this campaign.</p>}
    </main>
  );
}
