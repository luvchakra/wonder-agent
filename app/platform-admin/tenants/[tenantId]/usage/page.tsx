import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenant, getUsageSummary } from "@/modules/platform-admin/service";
import { Card, StatusBadge, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { PageHeading } from "../../../PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const STATUS = {
  ok: { tone: "success", label: "OK" },
  soft_warning: { tone: "warning", label: "Approaching limit" },
  hard_block: { tone: "danger", label: "At or over limit" },
  unlimited: { tone: "neutral", label: "No subscription (unlimited)" },
} as const;

/** PLATFORM-P0-05.1 — usage vs. limit for one tenant. */
export default async function TenantUsagePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const tenant = await getTenant(tenantId);
  if (!tenant) notFound();

  const usage = await getUsageSummary(tenantId);

  return (
    <>
      <Link href="/platform-admin/tenants" className="text-sm font-medium text-primary hover:underline">
        ← Tenants
      </Link>
      <PageHeading title={`Usage — ${tenant.name}`} />
      <Card>
        <TableContainer label="Usage" bare>
          <Thead>
            <tr>
              <Th>Resource</Th>
              <Th className="text-right">Current</Th>
              <Th className="text-right">Limit</Th>
              <Th>Status</Th>
            </tr>
          </Thead>
          <tbody>
            {usage.map((u) => (
              <Tr key={u.resource}>
                <Td className="font-medium">{u.resource}</Td>
                <Td className="tabular-nums md:text-right">{u.current.toLocaleString()}</Td>
                <Td className="tabular-nums md:text-right">{u.limit === null || u.limit === undefined ? "—" : u.limit.toLocaleString()}</Td>
                <Td>
                  <StatusBadge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</StatusBadge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableContainer>
      </Card>
    </>
  );
}
