import Link from "next/link";
import { getTenant, getUsageSummary } from "@/modules/platform-admin/service";
import { notFound } from "next/navigation";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  soft_warning: "Approaching limit",
  hard_block: "At/over limit",
  unlimited: "No subscription (unlimited)",
};

/** PLATFORM-P0-05.1 — usage vs. limit for one tenant. */
export default async function TenantUsagePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const tenant = await getTenant(tenantId);
  if (!tenant) notFound();

  const usage = await getUsageSummary(tenantId);

  return (
    <main>
      <p>
        <Link href="/platform-admin/tenants">← Tenants</Link>
      </p>
      <h1>Usage — {tenant.name}</h1>

      <table border={1} cellPadding={6} style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Current</th>
            <th>Limit</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.resource}>
              <td>{u.resource}</td>
              <td>{u.current}</td>
              <td>{u.limit ?? "—"}</td>
              <td>{STATUS_LABEL[u.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
