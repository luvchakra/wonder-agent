import { listFlagCatalog, listTenants, listTenantFlagOverrides, listConfigVersions } from "@/modules/platform-admin/service";
import { setFeatureFlagAction, updateFeatureFlagDefaultAction, rollbackConfigVersionAction } from "@/app/actions/platform";
import { Badge, Button, Card, CardHeader, TableContainer, Td, Th, Thead, Tr, fieldInputClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { PageHeading } from "../PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const compactSelect = cn(fieldInputClass, "w-auto py-1");

export default async function PlatformFeaturesPage() {
  const [flags, tenants] = await Promise.all([listFlagCatalog(), listTenants()]);
  const rollbackWithPath = rollbackConfigVersionAction.bind(null, "/platform-admin/features");
  // Independent reads, in parallel (§15).
  const [versionsByFlag, overridesByTenant] = await Promise.all([
    Promise.all(flags.map((f) => listConfigVersions("feature_flag_default", f.key))),
    Promise.all(tenants.map((t) => listTenantFlagOverrides(t.tenantId))),
  ]);
  const flagName = new Map(flags.map((f) => [f.key, f.displayName]));

  return (
    <>
      <PageHeading title="Feature Flags" description="Defaults apply to every organization unless it has an override. Default changes are versioned." />

      <Card>
        <TableContainer label="Feature flag defaults" bare>
          <Thead>
            <tr>
              <Th>Flag</Th>
              <Th>Default</Th>
              <Th className="text-right">Change</Th>
            </tr>
          </Thead>
          <tbody>
            {flags.map((f, i) => {
              const last = versionsByFlag[i][0];
              return (
                <Tr key={f.key}>
                  <Td>
                    <div className="min-w-0">
                      <p className="font-medium">{f.displayName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{f.key}</p>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={f.defaultEnabled ? "success" : "neutral"}>{f.defaultEnabled ? "On" : "Off"}</Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <form action={updateFeatureFlagDefaultAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="flagKey" value={f.key} />
                        <select name="defaultEnabled" defaultValue={f.defaultEnabled ? "true" : "false"} aria-label={`Default for ${f.displayName}`} className={compactSelect}>
                          <option value="true">On</option>
                          <option value="false">Off</option>
                        </select>
                        <Button type="submit" size="sm" variant="outline">
                          Set default
                        </Button>
                      </form>
                      {last ? (
                        <form action={rollbackWithPath}>
                          <input type="hidden" name="versionId" value={last.id} />
                          <Button type="submit" size="sm" variant="ghost" title={`Changed ${new Date(last.createdAt).toLocaleString()}`}>
                            Undo last change
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableContainer>
      </Card>

      <Card>
        <CardHeader title="Organization overrides" />
        <ul className="divide-y divide-border">
          {tenants.map((t, i) => {
            const overrides = Object.entries(overridesByTenant[i]);
            return (
              <li key={t.tenantId} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <form action={setFeatureFlagAction.bind(null, t.tenantId)} className="flex flex-wrap items-center gap-1.5">
                    <select name="flagKey" aria-label={`Flag for ${t.name}`} className={compactSelect}>
                      {flags.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.displayName}
                        </option>
                      ))}
                    </select>
                    <select name="enabled" defaultValue="true" aria-label={`Value for ${t.name}`} className={compactSelect}>
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      Set
                    </Button>
                  </form>
                </div>
                {overrides.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No overrides: uses the defaults.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {overrides.map(([key, on]) => (
                      <Badge key={key} tone={on ? "success" : "neutral"}>
                        {flagName.get(key) ?? key}: {on ? "On" : "Off"}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
