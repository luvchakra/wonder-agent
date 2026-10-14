import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { BASKET_LIMITS, listRequestCatalog } from "@/modules/access-governance/service";
import { getIdentityForUser, listAccountableHumans, listDirectReports, listOwnedIdentities } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody } from "@/modules/ui";
import { BasketForm } from "./BasketForm";

export const metadata = { title: "Request for several" };

// ACCESS-P0-38 — one basket: several people, several items, sent together.
// Each item for each person is its own request with its own approval.
export default async function RequestBasketPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.request");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const me = await getIdentityForUser(tenantId, ctx.userId);
  const [catalog, reports, owned, everyone] = await Promise.all([
    listRequestCatalog(tenantId, { pageSize: 50, requestableOnly: true }),
    listDirectReports(tenantId, me?.id ?? null),
    listOwnedIdentities(tenantId, ctx.userId, me?.id ?? null),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
  ]);
  const people = new Map<string, string>();
  if (me) people.set(me.id, "Myself");
  for (const r of reports) people.set(r.id, r.displayName);
  for (const o of owned) if (!people.has(o.id)) people.set(o.id, o.displayName);
  for (const p of everyone) if (!people.has(p.id)) people.set(p.id, p.displayName);
  const items = catalog.items.flatMap((app) => [
    ...(app.appRequestable ? [{ value: `${app.applicationId}|`, label: `${app.name} — account` }] : []),
    ...app.entitlements.filter((e) => e.requestable).map((e) => ({ value: `${app.applicationId}|${e.id}`, label: `${app.name} — ${e.name}` })),
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access/catalog" className="hover:text-foreground hover:underline">
          Request access
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Several at once</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Request for several</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Up to {BASKET_LIMITS.lines} items for up to {BASKET_LIMITS.subjects} people. Each is approved on its own.
        </p>
      </div>
      <Card>
        <CardBody>
          <BasketForm people={[...people].map(([id, label]) => ({ id, label }))} items={items} />
        </CardBody>
      </Card>
    </div>
  );
}
