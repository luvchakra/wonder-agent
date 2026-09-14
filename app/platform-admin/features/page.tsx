import { listFlagCatalog, listTenants, listTenantFlagOverrides } from "@/modules/platform-admin/service";
import { setFeatureFlagAction } from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformFeaturesPage() {
  const [flags, tenants] = await Promise.all([listFlagCatalog(), listTenants()]);

  return (
    <main>
      <h1>Feature Flags</h1>
      <h2>Catalog</h2>
      <ul>
        {flags.map((f) => (
          <li key={f.key}>
            <strong>{f.key}</strong> — {f.displayName} (default: {f.defaultEnabled ? "on" : "off"})
          </li>
        ))}
      </ul>

      <h2>Per-tenant overrides</h2>
      {await Promise.all(
        tenants.map(async (t) => {
          const overrides = await listTenantFlagOverrides(t.tenantId);
          const setFlagWithId = setFeatureFlagAction.bind(null, t.tenantId);
          return (
            <section key={t.tenantId} style={{ marginBottom: "1rem" }}>
              <h3>{t.name}</h3>
              <ul>
                {flags.map((f) => (
                  <li key={f.key}>
                    {f.key}: {overrides[f.key] !== undefined ? (overrides[f.key] ? "on" : "off") : `(default: ${f.defaultEnabled ? "on" : "off"})`}
                  </li>
                ))}
              </ul>
              <form action={setFlagWithId}>
                <select name="flagKey">
                  {flags.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.key}
                    </option>
                  ))}
                </select>
                <select name="enabled" defaultValue="true">
                  <option value="true">on</option>
                  <option value="false">off</option>
                </select>
                <button type="submit">Set</button>
              </form>
            </section>
          );
        }),
      )}
    </main>
  );
}
