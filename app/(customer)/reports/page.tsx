import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ReportType } from "@/lib/shared/types/operations";
import { Card, CardHeader, CardBody } from "@/modules/ui";

const REPORTS: { type: ReportType; label: string; description: string }[] = [
  { type: "agent_inventory", label: "AI Agent Inventory", description: "Every registered agent, its owner, lifecycle state and criticality." },
  { type: "ownership", label: "Ownership Report", description: "Agents missing an accountable owner." },
  { type: "access_certification", label: "Access Certification Report", description: "Certification campaign coverage and outcomes." },
  { type: "rogue_agent", label: "Rogue Agent Report", description: "Agents with open critical/high findings." },
  { type: "access_violation", label: "Access Violation Report", description: "Excessive, unauthorized, or sensitive-data access findings." },
  { type: "risk", label: "Risk Report", description: "Risk findings across every category and severity." },
  { type: "audit_evidence", label: "Audit Evidence Report", description: "Security-sensitive audit events, for compliance evidence." },
  { type: "policy_compliance", label: "Policy Compliance Report", description: "Policy evaluation results across every agent." },
];

// OPERATIONS-P0-04.1/04.2.
export default async function ReportsPage() {
  try {
    await requirePermission("report.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every report is computed live from current data at generation time — never cached.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {REPORTS.map((r) => (
          <Card key={r.type}>
            <CardHeader title={r.label} description={r.description} />
            <CardBody className="flex items-center gap-4">
              <Link href={`/reports/${r.type}`} className="text-sm text-primary hover:underline">
                View report →
              </Link>
              <a href={`/api/v1/reports/${r.type}/export?format=csv`} className="text-sm text-primary hover:underline">
                Export CSV
              </a>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
