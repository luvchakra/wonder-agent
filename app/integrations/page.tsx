import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrations } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";

// Bare functional list — Experience Agent (Module 08) owns visual design.
export default async function IntegrationsPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const integrations = await listIntegrations(ctx.tenantId!);

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Integrations</h1>
      <p>
        <Link href="/integrations/new">+ Add integration</Link>
      </p>
      {integrations.length === 0 ? (
        <p>No integrations configured yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Last sync</th>
            </tr>
          </thead>
          <tbody>
            {integrations.map((i) => (
              <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>
                  <Link href={`/integrations/${i.id}`}>{i.name}</Link>
                </td>
                <td>{i.integrationTypeId}</td>
                <td>{i.status}</td>
                <td>{i.lastSyncAt ?? "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
