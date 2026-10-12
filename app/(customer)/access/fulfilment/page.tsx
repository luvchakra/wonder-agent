import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listFulfilmentTasks, type FulfilmentTask } from "@/modules/access-governance/service";
import { Badge, type BadgeTone, Card, CardBody, EmptyState } from "@/modules/ui";
import { TaskActions } from "./TaskActions";
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
  const tasks = await listFulfilmentTasks(ctx.tenantId!, { view });

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
                        Account {accountLabel(t.accountName)} · {t.assigneeName ? `owner ${t.assigneeName}` : "no owner: access managers"} · due {day(t.dueAt)}
                        {t.failureReason && t.status === "failed" ? ` · ${t.failureReason}` : ""}
                        {t.connectorError && t.connectorStatus === "failed" && t.status === "open" ? ` · Connector: ${t.connectorError}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {t.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                        {t.connectorStatus ? <Badge tone={CONNECTOR[t.connectorStatus].tone}>{CONNECTOR[t.connectorStatus].label}</Badge> : null}
                      </div>
                    </div>
                    <TaskActions taskId={t.id} status={t.status} mine={t.claimedBy === ctx.userId} label={label} connectorStatus={t.connectorStatus} />
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
