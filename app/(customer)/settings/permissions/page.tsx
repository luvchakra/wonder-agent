import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { MODULE_LABEL, PERMISSION_MODULES, SENSITIVITIES, filterCatalog, listPermissionCatalog, type Sensitivity } from "@/lib/rbac/permissionCatalog";
import { roleLabel } from "@/lib/users/userRules";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass, type BadgeTone } from "@/modules/ui";

// FOUNDATION-P0-24 — the permission catalog (spec §13–14, 28; mockup
// "Permission catalog"): every permission WonderID knows, grouped by
// product module, with its resource and action, how sensitive it is and
// which roles grant it. Read-only: permission ids are defined by the
// product, never invented by a customer.

export const metadata = { title: "Permissions" };

const SENSITIVITY_TONE: Record<Sensitivity, BadgeTone> = { standard: "neutral", sensitive: "warning", privileged: "danger" };
const SENSITIVITY_LABEL: Record<Sensitivity, string> = { standard: "Standard", sensitive: "Sensitive", privileged: "Privileged" };

export default async function PermissionCatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; module?: string; sensitivity?: string }> }) {
  try {
    await requirePermission("permissions.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const moduleFilter = (PERMISSION_MODULES as readonly string[]).includes(sp.module ?? "") ? sp.module! : "";
  const sensitivity = (SENSITIVITIES as readonly string[]).includes(sp.sensitivity ?? "") ? sp.sensitivity! : "";
  const all = await listPermissionCatalog();
  const items = filterCatalog(all, { q, module: moduleFilter, sensitivity });
  const filtered = !!(q || moduleFilter || sensitivity);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Permission catalog</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every permission in WonderID, by product area. Roles are built from these; the identifiers are fixed by the product so policies and audits stay
          comparable.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {PERMISSION_MODULES.map((m) => {
          const n = all.filter((p) => p.module === m).length;
          return (
            <Link
              key={m}
              href={`/settings/permissions?module=${m}`}
              aria-current={moduleFilter === m ? "page" : undefined}
              className={
                moduleFilter === m
                  ? "rounded-full border border-primary bg-primary/10 px-3 py-1 font-medium text-primary"
                  : "rounded-full border border-border bg-card px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {MODULE_LABEL[m]} <span className="tabular-nums">({n})</span>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader title={filtered ? `${items.length} of ${all.length} permissions` : `${all.length} permissions`} />
        <CardBody className="space-y-4">
          <form method="get" role="search" aria-label="Filter permissions" className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="q" className={fieldLabelClass}>
                Search
              </label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Permission, resource or description" className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="module" className={fieldLabelClass}>
                Module
              </label>
              <select id="module" name="module" defaultValue={moduleFilter} className={fieldInputClass}>
                <option value="">All modules</option>
                {PERMISSION_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {MODULE_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sensitivity" className={fieldLabelClass}>
                Sensitivity
              </label>
              <select id="sensitivity" name="sensitivity" defaultValue={sensitivity} className={fieldInputClass}>
                <option value="">Any</option>
                {SENSITIVITIES.map((s) => (
                  <option key={s} value={s}>
                    {SENSITIVITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-9 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-accent">
              Filter
            </button>
            {filtered ? (
              <Link href="/settings/permissions" className="h-9 px-2 text-sm leading-9 text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            ) : null}
          </form>

          {items.length === 0 ? (
            <EmptyState title="No permission matches" description="Try another search or filter." />
          ) : (
            PERMISSION_MODULES.filter((m) => items.some((p) => p.module === m)).map((m) => (
              <section key={m} aria-labelledby={`module-${m}`} className="space-y-2">
                <h2 id={`module-${m}`} className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {MODULE_LABEL[m]}
                </h2>
                <TableContainer>
                  <Thead>
                    <tr>
                      <Th>Permission</Th>
                      <Th hideBelow="lg">Resource · action</Th>
                      <Th>Sensitivity</Th>
                      <Th hideBelow="xl">Granted by system roles</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {items
                      .filter((p) => p.module === m)
                      .map((p) => (
                        <Tr key={p.key}>
                          <Td>
                            <span className="block font-medium text-foreground">{p.label}</span>
                            <code className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{p.key}</code>
                          </Td>
                          <Td hideBelow="lg" className="text-muted-foreground">
                            {p.resource} · {p.action}
                          </Td>
                          <Td>
                            <Badge tone={SENSITIVITY_TONE[p.sensitivity]}>{SENSITIVITY_LABEL[p.sensitivity]}</Badge>
                          </Td>
                          <Td hideBelow="xl">
                            <span className="text-xs text-muted-foreground">{p.roles.length ? p.roles.map(roleLabel).join(", ") : "No role yet"}</span>
                          </Td>
                        </Tr>
                      ))}
                  </tbody>
                </TableContainer>
              </section>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
