import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { activeGroupIdsOf, fulfilmentWorkload, listFulfilmentTasks, type FulfilmentTask } from "@/modules/access-governance/service";
import { getIdentityForUser, listAccountableHumans } from "@/modules/agent-identity/service";
import { listGroups } from "@/lib/users/groups";
import { Badge, type BadgeTone, Card, CardBody, EmptyState } from "@/modules/ui";
import { ReassignTask, TaskActions } from "./TaskActions";
import { TASK_STATUS, accountLabel, taskLabel } from "./labels";

// ACCESS-P0-29 — approved access waiting for a person to make the change on
// the target (until provisioning exists, F3). Soonest due first; a task
// closes itself when reconciliation finds the access.

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// INTEGRATION-P0-13: what the connector did with the task, if it tried.
const CONNECTOR: Record<NonNullable<FulfilmentTask["connectorStatus"]>, { label: string; tone: BadgeTone }> = {
  running: { label: "Connector working", tone: "info" },
  succeeded: { label: "Done by connector", tone: "success" },
  failed: { label: "Connector failed", tone: "danger" },
};

export default async function FulfilmentTasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const view = (await searchParams).view === "all" ? "all" : "todo";
  const tenantId = ctx.tenantId!;
  const canApprove = ctx.permissions.includes("access.approve");
  const [tasks, me, myGroups, people, groups, load] = await Promise.all([
    listFulfilmentTasks(tenantId, { view }),
    getIdentityForUser(tenantId, ctx.userId),
    activeGroupIdsOf(tenantId, ctx.userId),
    listAccountableHumans(tenantId),
    listGroups(tenantId).catch(() => []),
    view === "all" ? fulfilmentWorkload(tenantId) : Promise.resolve([]),
  ]);
  // ACCESS-P0-42: who a task can go to; the server checks again.
  const choices = [
    ...groups.filter((g) => g.status === "active").map((g) => ({ value: `group:${g.id}`, label: `${g.name} (group)` })),
    ...people.map((p) => ({ value: `identity:${p.id}`, label: p.displayName })),
  ];
  const mayReassign = (t: FulfilmentTask) =>
    ["open", "claimed", "failed"].includes(t.status) &&
    (canApprove || t.claimedBy === ctx.userId || (!!me && t.assigneeIdentityId === me.id) || (!!t.assigneeGroupId && myGroups.includes(t.assigneeGroupId)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Fulfilment tasks</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Approved access to set up on the target. Each closes when the next sync finds it there.</p>
        </div>
        <Link href={view === "all" ? "/access/fulfilment" : "/access/fulfilment?view=all"} className="text-sm text-primary hover:underline">
          {view === "all" ? "Show to do" : "Show all"}
        </Link>
      </div>

      {load.length ? (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Workload</summary>
          <ul className="mt-3 space-y-1.5 text-sm">
            {load.map((w) => (
              <li key={w.key} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-foreground">{w.name}</span>
                <span className="text-xs text-muted-foreground">
                  {w.open + w.claimed + w.failed} to do{w.claimed ? ` · ${w.claimed} claimed` : ""}
                  {w.failed ? ` · ${w.failed} failed` : ""}
                  {w.overdue ? <span className="text-destructive"> · {w.overdue} overdue</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Card>
        <CardBody className="p-0">
          {tasks.length === 0 ? (
            <div className="p-6">
              <EmptyState title={view === "all" ? "No fulfilment tasks yet" : "Nothing to fulfil"} />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((t) => {
                const label = taskLabel(t);
                const status = TASK_STATUS[t.status] ?? { label: t.status, tone: "neutral" as BadgeTone };
                return (
                  <li key={t.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {t.requestId ? (
                          <Link href={`/access/requests/${t.requestId}`} className="hover:underline">
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t.reason === "leaver" ? "Person left · " : t.reason === "expired" ? "Approval ended · " : ""}
                        Account {accountLabel(t.accountName)} · {t.assigneeGroupName ? `group ${t.assigneeGroupName}` : t.assigneeName ? `owner ${t.assigneeName}` : "no owner: access managers"} · due {day(t.dueAt)}
                        {t.failureReason && t.status === "failed" ? ` · ${t.failureReason}` : ""}
                        {t.connectorError && t.connectorStatus === "failed" && t.status === "open" ? ` · Connector: ${t.connectorError}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {t.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                        {t.connectorStatus ? <Badge tone={CONNECTOR[t.connectorStatus].tone}>{CONNECTOR[t.connectorStatus].label}</Badge> : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <TaskActions taskId={t.id} status={t.status} mine={t.claimedBy === ctx.userId} label={label} connectorStatus={t.connectorStatus} />
                      {mayReassign(t) && t.connectorStatus !== "running" ? <ReassignTask taskId={t.id} label={label} choices={choices} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
