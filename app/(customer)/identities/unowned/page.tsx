import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAccountableHumans, listIdentities } from "@/modules/agent-identity/service";
import { Card, CardBody, CardHeader, EmptyState } from "@/modules/ui";
import { AssignOwnerForm } from "../IdentityForms";
import { IDENTITY_TYPE_LABEL } from "../labels";

// IDENTITY-P0-20 — the unowned identities queue (Onboarding): service
// accounts, machines, workloads, applications and APIs nobody is
// accountable for, most often made from imported accounts. Access cannot
// be requested for them until they have an owner.
export default async function UnownedIdentitiesPage() {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("identity.manage");
  const [{ rows, total }, people] = await Promise.all([
    listIdentities(tenantId, { unownedNonHuman: true, pageSize: 100 }),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Unowned identities</h1>
        <p className="mt-1 text-sm text-muted-foreground">Non-human identities with nobody accountable for them. Access cannot be requested for them until they have an owner.</p>
      </div>
      <Card>
        <CardHeader title={`${total} without an owner`} description={total > rows.length ? `Showing the first ${rows.length}.` : undefined} />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title="Every non-human identity has an owner" />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/identities/${r.id}`} className="font-medium text-foreground hover:underline">
                      {r.displayName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {IDENTITY_TYPE_LABEL[r.identityType]}
                      {r.sourceSystem ? ` · from ${r.sourceSystem.startsWith("account:") ? "an imported account" : r.sourceSystem}` : ""}
                    </p>
                  </div>
                  {canManage ? <AssignOwnerForm identityId={r.id} people={people} /> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
