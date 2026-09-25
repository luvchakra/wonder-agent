import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { listAgents } from "@/modules/agent-identity/service";
import { getInvestigation } from "@/modules/risk/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { InvestigationEvent } from "@/lib/shared/types/risk";
import { Badge, Card, CardBody, CardHeader, EmptyState, SeverityBadge } from "@/modules/ui";
import { AssignForm, NoteForm, StatusForm } from "../InvestigationForms";
import { STATUS_BADGE } from "../labels";
import { TRANSITIONS, isFindingOpen } from "@/modules/risk/investigationRules";

// RISK-P0-11 — one investigation: its findings with their evidence and
// recommended remediation, status and assignee controls, and the timeline.
// Remediation itself stays on each finding's own page (Risk's audited
// remediate flow); the investigation never changes a finding's state.

const fmt = (iso: string) => iso.slice(0, 16).replace("T", " ");

function describe(e: InvestigationEvent, name: (id: string | null) => string): string {
  const d = e.detail as Record<string, string | null | string[]>;
  switch (e.eventType) {
    case "created":
      return `Opened ${d.reference ?? ""} with ${(d.findingIds as string[] | undefined)?.length ?? 0} finding(s), priority ${d.priority}`;
    case "status_changed":
      return `Status ${String(d.from).replace(/_/g, " ")} → ${String(d.to).replace(/_/g, " ")}${d.reason ? `: ${d.reason}` : ""}`;
    case "assigned":
      return d.to ? `Assigned to ${name(d.to as string)}` : "Unassigned";
    case "finding_added":
      return "Finding added";
    case "finding_removed":
      return "Finding removed";
    case "priority_changed":
      return `Priority ${d.from} → ${d.to}`;
    case "note":
      return String(d.note ?? "");
  }
}

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { id } = await params;
  const tenantId = ctx.tenantId!;
  const [inv, members, agents] = await Promise.all([getInvestigation(tenantId, id), listTenantMembersWithRoles(tenantId), listAgents(tenantId)]);
  if (!inv) notFound();

  const canManage = ctx.permissions.includes("risk.manage");
  const memberName = new Map(members.map((m) => [m.userId, m.displayName?.trim() || m.email]));
  const name = (uid: string | null) => (uid ? memberName.get(uid) ?? "Former member" : "System");
  const agentName = new Map(agents.map((a) => [a.id, a.displayName?.trim() || a.agentName]));
  const openCount = inv.findings.filter((f) => isFindingOpen(f.status)).length;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/risk/investigations" className="hover:text-foreground hover:underline">
          Investigations
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{inv.reference}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{inv.reference}</p>
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{inv.title}</h1>
          {inv.summary ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{inv.summary}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={inv.priority} />
          <Badge tone={STATUS_BADGE[inv.status].tone} className="whitespace-nowrap">
            {STATUS_BADGE[inv.status].label}
          </Badge>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Assignee</dt>
          <dd className="mt-1 font-medium text-foreground">{inv.assigneeId ? name(inv.assigneeId) : "Unassigned"}</dd>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Findings still open</dt>
          <dd className="mt-1 font-medium text-foreground">
            {openCount} of {inv.findings.length}
          </dd>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Opened</dt>
          <dd className="mt-1 font-medium text-foreground">
            {fmt(inv.createdAt)} by {name(inv.createdBy)}
          </dd>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{inv.status === "closed" ? "Closed" : "Resolved"}</dt>
          <dd className="mt-1 font-medium text-foreground">{inv.resolvedAt ? fmt(inv.resolvedAt) : "—"}</dd>
        </div>
      </dl>
      {inv.resolution ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          <span className="font-medium">Resolution: </span>
          {inv.resolution}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Findings" description="Evidence and the recommended remediation for each. Remediate from the finding's own page." />
            <CardBody>
              <ul className="space-y-3">
                {inv.findings.map((f) => (
                  <li key={f.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/risk/agents/${f.agentId}`} className="font-medium text-primary hover:underline">
                          {f.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {agentName.get(f.agentId) ?? "Unknown agent"} · {f.category.replace(/_/g, " ")} · {f.status.replace(/_/g, " ")}
                        </p>
                      </div>
                      <SeverityBadge severity={f.severity} />
                    </div>
                    <p className="mt-2 text-sm text-foreground">{f.explanation}</p>
                    <p className="mt-2 text-sm">
                      <span className="font-medium text-foreground">Recommended: </span>
                      <span className="text-muted-foreground">{f.recommendation}</span>
                    </p>
                    {f.evidence && f.evidence.length > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Evidence ({f.evidence.length})</summary>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {f.evidence.map((e) => (
                            <li key={e.id}>
                              <span className="font-medium text-foreground">{e.evidenceType.replace(/_/g, " ")}</span> — {e.summary}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              {inv.events.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ol className="space-y-3 border-l border-border pl-4">
                  {inv.events.map((e) => (
                    <li key={e.id} className="relative">
                      <span aria-hidden className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                      <p className="text-sm text-foreground">{describe(e, name)}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(e.createdAt)} · {name(e.actorId)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {canManage ? (
          <div className="space-y-5">
            <Card>
              <CardHeader title="Status" description={openCount > 0 ? `${openCount} open finding(s): it cannot be resolved yet.` : undefined} />
              <CardBody>
                <StatusForm id={inv.id} allowed={TRANSITIONS[inv.status]} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Assignee" />
              <CardBody>
                <AssignForm id={inv.id} current={inv.assigneeId} members={members.map((m) => ({ id: m.userId, name: m.displayName?.trim() || m.email }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Note" />
              <CardBody>
                <NoteForm id={inv.id} />
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
