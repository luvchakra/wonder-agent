import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { generateReport } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ReportType } from "@/lib/shared/types/operations";

const VALID_TYPES: ReportType[] = [
  "agent_inventory",
  "ownership",
  "access_certification",
  "rogue_agent",
  "access_violation",
  "risk",
  "audit_evidence",
  "policy_compliance",
];

// Bare functional screen — Experience Agent (Module 08) owns visual design.
export default async function ReportDetailPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  let ctx;
  try {
    ctx = await requirePermission("report.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  if (!VALID_TYPES.includes(type as ReportType)) redirect("/reports");

  const report = await generateReport(ctx.tenantId!, type as ReportType);
  const fieldKeys = report.rows.length > 0 ? Object.keys(report.rows[0]!.fields) : [];

  return (
    <main style={{ maxWidth: 1000, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/reports">← Reports</Link>
      </p>
      <h1>{type}</h1>
      <p>
        Generated at {report.generatedAt} · {report.recordCount} records ·{" "}
        <a href={`/api/v1/reports/${type}/export?format=csv`}>Export CSV</a>
      </p>

      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            {fieldKeys.map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.id}>
              {fieldKeys.map((k) => (
                <td key={k}>
                  {k === fieldKeys[0] ? (
                    <Link href={row.href}>{String(row.fields[k] ?? "")}</Link>
                  ) : (
                    String(row.fields[k] ?? "")
                  )}
                </td>
              ))}
            </tr>
          ))}
          {report.rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(fieldKeys.length, 1)}>No records.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
