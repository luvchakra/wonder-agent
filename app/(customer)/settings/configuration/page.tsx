import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getTenantConfig, listTenantConfigVersions } from "@/lib/config/tenantConfig";
import { settingFor } from "@/lib/config/registry";
import { Card, CardBody } from "@/modules/ui";
import { ConfigForm, RestoreVersionButton } from "./ConfigForms";

// Admin › Global Configuration (owner request, 2026-10-10): the settings
// that change how WonderID behaves for this organization (lib/config).
// Readable with tenant.settings or tenant.security.manage; each setting is
// changed only with its own permission. Every save is a version, audited,
// and any version can be restored.

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export default async function GlobalConfigurationPage() {
  let ctx;
  try {
    ctx = await requireAnyPermission(["tenant.settings", "tenant.security.manage"]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const [config, versions] = await Promise.all([getTenantConfig(tenantId), listTenantConfigVersions(tenantId)]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Global Configuration</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Settings that change how WonderID behaves for this organization. Changes apply right away.</p>
      </div>

      <ConfigForm config={config} permissions={ctx.permissions} />

      <details className="group rounded-lg border border-border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground">
          Change history <span className="text-muted-foreground">({versions.length ? `${versions.length} ${versions.length === 1 ? "version" : "versions"}` : "none yet"})</span>
        </summary>
        <Card className="rounded-t-none border-0 border-t shadow-none">
          <CardBody>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every setting is at its default. Saved versions appear here.</p>
            ) : (
              <ol className="divide-y divide-border">
                {versions.map((v, i) => (
                  <li key={v.version} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-foreground">
                        Version {v.version}
                        {v.restoredFrom ? <span className="font-normal text-muted-foreground"> · restored version {v.restoredFrom}</span> : null}
                        {i === 0 ? <span className="font-normal text-muted-foreground"> · current</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {v.createdBy?.name ?? "Unknown"} · {when(v.createdAt)}
                      </p>
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {v.changes.map((c) => {
                          const s = settingFor(c.key);
                          return (
                            <li key={c.key}>
                              {s?.label ?? c.key}: {c.from} → {c.to} {s?.unit ?? ""}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    {i > 0 ? <RestoreVersionButton version={v.version} /> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </details>
    </div>
  );
}
