import { listTenants, getSubscription } from "@/modules/platform-admin/service";
import {
  createTenantAction,
  suspendTenantAction,
  activateTenantAction,
  decommissionTenantAction,
  createSubscriptionAction,
} from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformTenantsPage() {
  const tenants = await listTenants();
  const withSubscriptions = await Promise.all(
    tenants.map(async (t) => ({ tenant: t, subscription: await getSubscription(t.tenantId) })),
  );

  return (
    <main>
      <h1>Tenants</h1>

      <h2>Create tenant</h2>
      <form action={createTenantAction}>
        <input name="name" placeholder="Tenant name" required />
        <input name="slug" placeholder="slug" required />
        <select name="environment" defaultValue="production">
          <option value="production">production</option>
          <option value="sandbox">sandbox</option>
        </select>
        <button type="submit">Create</button>
      </form>

      <table border={1} cellPadding={6} style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Slug</th>
            <th>Status</th>
            <th>Environment</th>
            <th>Plan</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {withSubscriptions.map(({ tenant, subscription }) => {
            const suspendWithId = suspendTenantAction.bind(null, tenant.tenantId);
            const activateWithId = activateTenantAction.bind(null, tenant.tenantId);
            const decommissionWithId = decommissionTenantAction.bind(null, tenant.tenantId);
            const createSubWithId = createSubscriptionAction.bind(null, tenant.tenantId);
            return (
              <tr key={tenant.tenantId}>
                <td>{tenant.name}</td>
                <td>{tenant.slug}</td>
                <td>{tenant.status}</td>
                <td>{tenant.environment}</td>
                <td>
                  {subscription?.plan ?? (
                    <form action={createSubWithId}>
                      <select name="plan" defaultValue="free">
                        <option value="free">free</option>
                        <option value="pro">pro</option>
                        <option value="max">max</option>
                        <option value="enterprise">enterprise</option>
                      </select>
                      <button type="submit">Assign</button>
                    </form>
                  )}
                </td>
                <td>
                  <form action={suspendWithId} style={{ display: "inline" }}>
                    <button type="submit" disabled={tenant.status === "suspended"}>
                      Suspend
                    </button>
                  </form>{" "}
                  <form action={activateWithId} style={{ display: "inline" }}>
                    <button type="submit" disabled={tenant.status === "active"}>
                      Activate
                    </button>
                  </form>{" "}
                  <form action={decommissionWithId} style={{ display: "inline" }}>
                    <button type="submit" disabled={tenant.status === "deprovisioned"}>
                      Decommission
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tenants.length === 0 && <p>No tenants yet.</p>}
    </main>
  );
}
