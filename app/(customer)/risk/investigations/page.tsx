import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { listAgents } from "@/modules/agent-identity/service";
import { getFindings, listInvestigations } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { InvestigationStatus } from "@/lib/shared/types/risk";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard, SeverityBadge, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { CreateInvestigationForm } from "./InvestigationForms";
import { STATUS_BADGE } from "./labels";
import { isFindingOpen } from "@/modules/risk/investigationRules";

// RISK-P0-11 (master P0-37) — investigations: findings grouped into one
// tracked piece of work. Views are URL-driven so a filtered list is
// linkable. Four independent reads in parallel (§15).

const TABS: Array<{ key: "active" | InvestigationStatus | "all"; label: string }> = [
  { key: "active", label: "Active" },
  { key: "awaiting_remediation", label: "Awaiting remediation" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];
const ACTIVE: InvestigationStatus[] = ["open", "in_progress", "awaiting_remediation"];

export default async function InvestigationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const requested = (await searchParams).view;
  const view = (TABS.find((t) => t.key === requested)?.key ?? "active") as (typeof TABS)[number]["key"];
  const canManage = ctx.permissions.includes("risk.manage");

  const [investigations, openFindings, agents, members] = await Promise.all([
    listInvestigations(tenantId),
    // Every finding still needing action, not only status "open".
    canManage ? getFindings(tenantId).then((all) => all.filter((f) => isFindingOpen(f.status))) : Promise.resolve([]),
    canManage ? listAgents(tenantId) : Promise.resolve([]),
    listTenantMembersWithRoles(tenantId),
  ]);
  const memberName = new Map(members.map((m) => [m.userId, m.displayName?.trim() || m.email]));
  const agentName = new Map(agents.map((a) => [a.id, a.displayName?.trim() || a.agentName]));

  const inView = (s: InvestigationStatus) => (view === "all" ? true : view === "active" ? ACTIVE.includes(s) : s === view);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, investigations.filter((i) => (t.key === "all" ? true : t.key === "active" ? ACTIVE.includes(i.status) : i.status === t.key)).length]));
  const rows = investigations.filter((i) => inView(i.status));
  const active = investigations.filter((i) => ACTIVE.includes(i.status));

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/risk" className="hover:text-foreground hover:underline">
          Risk &amp; Investigations
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Investigations</span>
      </nav>

      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Investigations</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Related findings grouped into one tracked piece of work, with an owner and a timeline. An investigation is resolved only once
          none of its findings is still open.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard size="sm" icon="Search" tone="primary" label="Active" value={active.length} href="/risk/investigations?view=active" />
        <KpiCard size="sm" icon="Siren" tone="danger" label="Critical priority" value={active.filter((i) => i.priority === "critical").length} />
        <KpiCard size="sm" icon="Clock" tone="warning" label="Awaiting remediation" value={counts.awaiting_remediation} href="/risk/investigations?view=awaiting_remediation" />
        <KpiCard size="sm" icon="UserX" tone="neutral" label="Unassigned" value={active.filter((i) => !i.assigneeId).length} />
      </div>

      <Card className="p-4">
        <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]" aria-label="Investigation views">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/risk/investigations?view=${t.key}`}
              aria-current={view === t.key ? "page" : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                view === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label} <span className="ml-1 text-xs text-muted-foreground">({counts[t.key]})</span>
            </Link>
          ))}
        </nav>
        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState title="No investigations in this view" description={canManage ? "Open one below from the findings that belong together." : "Nothing to show yet."} />
          ) : (
            <TableContainer label="Investigations" bare>
              <Thead>
                <tr>
                  <Th>Investigation</Th>
                  <Th>Priority</Th>
                  <Th>Status</Th>
                  <Th>Findings</Th>
                  <Th hideBelow="lg">Assignee</Th>
                  <Th hideBelow="xl">Opened</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link href={`/risk/investigations/${i.id}`} className="block font-medium text-primary hover:underline">
                        {i.reference}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{i.title}</span>
                    </Td>
                    <Td>
                      <SeverityBadge severity={i.priority} />
                    </Td>
                    <Td>
                      <Badge tone={STATUS_BADGE[i.status].tone} className="whitespace-nowrap">
                        {STATUS_BADGE[i.status].label}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="md:whitespace-nowrap">
                        {i.openFindingCount} open of {i.findingCount}
                      </span>
                    </Td>
                    <Td hideBelow="lg">{i.assigneeId ? memberName.get(i.assigneeId) ?? "Former member" : <span className="text-muted-foreground">Unassigned</span>}</Td>
                    <Td hideBelow="xl">
                      <span className="md:whitespace-nowrap">{i.createdAt.slice(0, 10)}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </div>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title="Open an investigation" description="Recorded in the audit log and on the investigation's timeline." />
          <CardBody>
            {openFindings.length === 0 ? (
              <EmptyState title="No open findings" description="Investigations group open findings; there are none right now." />
            ) : (
              <CreateInvestigationForm
                findings={openFindings.slice(0, 50).map((f) => ({ id: f.id, title: f.title, agentName: agentName.get(f.agentId) ?? "Unknown agent", severity: f.severity }))}
              />
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
