import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { generateReport } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ReportType } from "@/lib/shared/types/operations";
import { Card, CardHeader, CardBody, EmptyState, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

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
    <div className="space-y-4">
      <Link href="/reports" className="text-sm text-primary hover:underline">
        ← Reports
      </Link>
      <div>
        <h1 className="text-xl font-semibold capitalize text-foreground">{type.replace(/_/g, " ")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generated at {report.generatedAt} · {report.recordCount} records ·{" "}
          <a href={`/api/v1/reports/${type}/export?format=csv`} className="text-primary hover:underline">
            Export CSV
          </a>
        </p>
      </div>

      <Card>
        <CardHeader title="Records" description={`${report.recordCount} total`} />
        <CardBody>
          {report.rows.length === 0 ? (
            <EmptyState title="No records" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  {fieldKeys.map((k) => (
                    <Th key={k}>{k}</Th>
                  ))}
                </tr>
              </Thead>
              <tbody>
                {report.rows.map((row) => (
                  <Tr key={row.id}>
                    {fieldKeys.map((k) => (
                      <Td key={k}>
                        {k === fieldKeys[0] ? (
                          <Link href={row.href} className="text-primary hover:underline">
                            {String(row.fields[k] ?? "")}
                          </Link>
                        ) : (
                          String(row.fields[k] ?? "")
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
