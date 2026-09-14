import { listFlagCatalog, listTenants, listTenantFlagOverrides, listConfigVersions } from "@/modules/platform-admin/service";
import { setFeatureFlagAction, updateFeatureFlagDefaultAction, rollbackConfigVersionAction } from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformFeaturesPage() {
  const [flags, tenants] = await Promise.all([listFlagCatalog(), listTenants()]);
  const rollbackWithPath = rollbackConfigVersionAction.bind(null, "/platform-admin/features");

  return (
    <main>
      <h1>Feature Flags</h1>
      <h2>Catalog (defaults are versioned — PLATFORM-P0-05.3)</h2>
      <ul>
        {await Promise.all(
          flags.map(async (f) => {
            const versions = await listConfigVersions("feature_flag_default", f.key);
            return (
              <li key={f.key} style={{ marginBottom: "0.75rem" }}>
                <strong>{f.key}</strong> — {f.displayName} (default: {f.defaultEnabled ? "on" : "off"})
                <form action={updateFeatureFlagDefaultAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
                  <input type="hidden" name="flagKey" value={f.key} />
                  <select name="defaultEnabled" defaultValue={f.defaultEnabled ? "true" : "false"}>
                    <option value="true">on</option>
                    <option value="false">off</option>
                  </select>
                  <button type="submit">Set default</button>
                </form>
                {versions.length > 0 && (
                  <form action={rollbackWithPath} style={{ display: "inline", marginLeft: "0.5rem" }}>
                    <input type="hidden" name="versionId" value={versions[0].id} />
                    <button type="submit">Roll back last default change ({versions[0].createdAt})</button>
                  </form>
                )}
              </li>
            );
          }),
        )}
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
