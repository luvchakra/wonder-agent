import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listCampaigns } from "@/modules/certification-compliance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { launchCampaignAction } from "@/app/actions/compliance";

// Bare functional screen — Experience Agent (Module 08) owns visual design,
// per docs/design/UI-UX-DESIGN-RULES.md. This page is functional scaffolding.
export default async function CampaignsPage() {
  let ctx;
  try {
    ctx = await requirePermission("compliance.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const campaigns = await listCampaigns(ctx.tenantId!);

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Certification Campaigns</h1>

      <h2>Launch a new campaign</h2>
      <form action={launchCampaignAction}>
        <input name="name" placeholder="Campaign name" required />
        <select name="scopeType" defaultValue="agent">
          <option value="agent">agent</option>
          <option value="application">application</option>
          <option value="entitlement">entitlement</option>
          <option value="privileged_access">privileged_access</option>
          <option value="high_risk_agent">high_risk_agent</option>
        </select>
        <input name="criticality" placeholder="criticality filter, e.g. high,critical" />
        <select name="cadence" defaultValue="one_time">
          <option value="one_time">one_time</option>
          <option value="periodic">periodic</option>
          <option value="event_driven">event_driven</option>
        </select>
        <input name="reviewerId" placeholder="reviewer user id (uuid, defaults to you)" />
        <button type="submit">Launch</button>
      </form>

      <h2>Campaigns</h2>
      <ul>
        {campaigns.map((c) => (
          <li key={c.id}>
            <Link href={`/compliance/campaigns/${c.id}`}>{c.name}</Link> — {c.scopeType} · {c.status}
          </li>
        ))}
      </ul>
      {campaigns.length === 0 && <p>No campaigns yet.</p>}
    </main>
  );
}
