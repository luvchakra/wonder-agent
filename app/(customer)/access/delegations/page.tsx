import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { listDelegations } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/modules/ui";
import { DelegationForm, RevokeDelegation } from "./DelegationForms";

export const metadata = { title: "Delegations" };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// ACCESS-P0-23 — hand your approvals (or, part 2, your requests) to someone
// while you are away. They act on your behalf; every action records both of you.
export default async function DelegationsPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const [delegations, members] = await Promise.all([listDelegations(tenantId), listTenantMembersWithRoles(tenantId)]);
  const name = (userId: string) => (userId === ctx.userId ? "You" : (members.find((m) => m.userId === userId)?.displayName ?? members.find((m) => m.userId === userId)?.email ?? "A former member"));
  const people = members.map((m) => ({ id: m.userId, label: m.displayName || m.email || "Member" }));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access/requests?view=waiting" className="hover:text-foreground hover:underline">
          Approvals
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Delegations</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Delegations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Someone decides your approvals, or asks for access for you, while you are away. Nobody decides a request they made or that is for them.</p>
      </div>
      <Card>
        <CardHeader title="In place" />
        <CardBody>
          {delegations.length === 0 ? (
            <EmptyState title="None" description="Add one below." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {delegations.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    {name(d.delegatorUserId)} → {name(d.delegateUserId)}
                    <span className="text-muted-foreground"> · {d.scope === "requests" ? "asking for access" : d.scope === "administration" ? "administration" : "approvals"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {day(d.startsAt)} – {day(d.endsAt)}
                      {d.reason ? ` · ${d.reason}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={d.active ? "success" : "neutral"}>{d.active ? "In force" : "Scheduled"}</Badge>
                    <RevokeDelegation id={d.id} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">New delegation</summary>
        <div className="mt-4">
          <DelegationForm people={people.filter((p) => p.id !== ctx.userId)} everyone={canManage ? people : null} canDelegateAdministration={ctx.permissions.includes("role.manage")} />
        </div>
      </details>
    </div>
  );
}
