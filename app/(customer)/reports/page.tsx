import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ReportType } from "@/lib/shared/types/operations";

const REPORTS: { type: ReportType; label: string }[] = [
  { type: "agent_inventory", label: "AI Agent Inventory" },
  { type: "ownership", label: "Ownership Report" },
  { type: "access_certification", label: "Access Certification Report" },
  { type: "rogue_agent", label: "Rogue Agent Report" },
  { type: "access_violation", label: "Access Violation Report" },
  { type: "risk", label: "Risk Report" },
  { type: "audit_evidence", label: "Audit Evidence Report" },
  { type: "policy_compliance", label: "Policy Compliance Report" },
];

// OPERATIONS-P0-04.1/04.2. Bare functional screen — Experience Agent
// (Module 08) owns visual design, per docs/design/UI-UX-DESIGN-RULES.md.
// Replaces the earlier "Reports isn't available yet" placeholder now that
// Operations Agent (this module) has run.
export default async function ReportsPage() {
  try {
    await requirePermission("report.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Reports</h1>
      <p>Every report is computed live from current data at generation time — never cached.</p>
      <ul>
        {REPORTS.map((r) => (
          <li key={r.type} style={{ margin: "0.5rem 0" }}>
            <Link href={`/reports/${r.type}`}>{r.label}</Link>
            {" · "}
            <a href={`/api/v1/reports/${r.type}/export?format=csv`}>Export CSV</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
