import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { listAgentDelegations, listDelegations } from "@/modules/access-governance/service";
import { listAgents, listOwnersForTenant } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, ObjectActionsMenu } from "@/modules/ui";
import { AgentDelegationForm, DecideAgentDelegation, DelegationForm, EndAgentDelegation, RevokeDelegation } from "./DelegationForms";

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
  const caller = { userId: ctx.userId, canManageAccess: canManage };
  const [delegations, members, agentDelegations, agents, owners] = await Promise.all([
    listDelegations(tenantId),
    listTenantMembersWithRoles(tenantId),
    // ACCESS-P0-23 part 4: delegations to AI agents.
    listAgentDelegations(tenantId, caller),
    listAgents(tenantId),
    listOwnersForTenant(tenantId),
  ]);
  const agentName = (id: string | null) => {
    const a = agents.find((x) => x.id === id);
    return a ? a.displayName || a.agentName : "An agent";
  };
  const agentOptions = agents.map((a) => ({ id: a.id, label: a.displayName || a.agentName }));
  const ownAgents = agentOptions.filter((a) => owners.some((o) => o.agentId === a.id && o.userId === ctx.userId && !o.removedAt));
  const from = (d: (typeof agentDelegations.mine)[number]) => (d.delegatorKind === "agent" ? `Agent ${agentName(d.delegatorAgentId)}` : name(d.delegatorUserId ?? ""));
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Delegations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Someone decides your approvals, or asks for access for you, while you are away. Nobody decides a request they made or that is for them.</p>
        </div>
        <ObjectActionsMenu
          create={{
            label: "New delegation…",
            title: "New delegation",
            content: (
              <div className="space-y-5">
                <DelegationForm people={people.filter((p) => p.id !== ctx.userId)} everyone={canManage ? people : null} canDelegateAdministration={ctx.permissions.includes("role.manage")} />
                {agentOptions.length ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-sm font-medium text-foreground">Or let an AI agent act for you</p>
                    <AgentDelegationForm agents={agentOptions} ownAgents={ownAgents} />
                  </div>
                ) : null}
              </div>
            ),
          }}
        />
      </div>
      <Card>
        <CardHeader title="In place" />
        <CardBody>
          {delegations.length === 0 ? (
            <EmptyState title="None" description="Add one from Actions." />
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
      {agentDelegations.toDecide.length ? (
        <Card>
          <CardHeader title="Waiting for you" description="You own these agents. Approve before they may act for someone." />
          <CardBody>
            <ul className="divide-y divide-border text-sm" aria-label="Agent delegations waiting for you">
              {agentDelegations.toDecide.map((d) => (
                <li key={d.id} className="space-y-2 py-2.5">
                  <p>
                    {agentName(d.delegateAgentId)} acts for {from(d)} <span className="text-muted-foreground">· {d.actions.join(", ")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.applications.length ? `${d.applications.join(", ")} · ` : ""}until {day(d.endsAt)} · {d.reason}
                    </span>
                  </p>
                  <DecideAgentDelegation id={d.id} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="AI agents acting for someone" description="The Runtime Gateway holds an agent's request on someone's behalf for approval unless one of these covers it." />
        <CardBody>
          {agentDelegations.mine.length === 0 ? (
            <EmptyState title="None" description="Let an agent act for you from Actions." />
          ) : (
            <ul className="divide-y divide-border text-sm" aria-label="Agent delegations">
              {agentDelegations.mine.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    {agentName(d.delegateAgentId)} acts for {from(d)}
                    <span className="text-muted-foreground"> · {d.actions.join(", ")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.applications.length ? `${d.applications.join(", ")} · ` : ""}
                      {day(d.startsAt)} – {day(d.endsAt)} · {d.reason}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={d.inForce ? "success" : d.status === "pending" ? "warning" : "neutral"}>{d.status === "pending" ? "Waiting for the agent's owner" : d.inForce ? "In force" : "Scheduled"}</Badge>
                    <EndAgentDelegation id={d.id} pendingApproval={d.status === "pending"} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
