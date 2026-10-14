import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  listFulfilmentTasks,
  activeGroupIdsOf,
  listRequestIdsAwaiting,
  listRequests,
  repairApprovalChains,
  requestProgressFor,
  sweepApprovalTimeouts,
  type FulfilmentTask,
} from "@/modules/access-governance/service";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, type BadgeTone, Card, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr, ObjectActionsMenu } from "@/modules/ui";
import { objectActionsFor } from "@/modules/operations/exportRegistry";
import { cn } from "@/lib/utils";
import { RequestActions } from "./RequestActions";
import { lineState } from "./labels";
import { TaskActions } from "../fulfilment/TaskActions";
import { TASK_STATUS, accountLabel, taskLabel } from "../fulfilment/labels";

// ACCESS-P0-18 — access requests: the caller's own, those waiting for a
// decision, or all, paged at the database (§15). Requests for people and
// other identities (the request catalog) and agent requests share the list.
// ACCESS-P0-19 — "waiting for you" is what the caller may decide now: a
// step of a catalog request that names them (a manager or owner needs no
// approver role), a step open to access managers, or, for access managers,
// a waiting agent request.
// EXPERIENCE-P0-29 — "waiting for you" is the one inbox: the fulfilment tasks
// waiting for the caller are listed there too, and every line shows its real
// state (approved, then waiting for fulfilment, not yet verified, verified,
// failed or ended), never more than the server knows.

const PAGE_SIZE = 50;
const RISK_TONE: Record<string, BadgeTone> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

type View = "mine" | "waiting" | "all";

export default async function AccessRequestsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const sp = await searchParams;
  const canApprove = ctx.permissions.includes("access.approve");
  const canRequest = ctx.permissions.includes("access.request");
  const asked: View | null = sp.view === "all" || sp.view === "mine" || sp.view === "waiting" ? sp.view : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  let awaiting: string[] = [];
  let myTasks: FulfilmentTask[] = [];
  if (asked === null || asked === "waiting") {
    // Steps past their time are escalated or expired, and waiting requests
    // without a chain get one, before anyone is shown what waits for them.
    await sweepApprovalTimeouts(ctx.tenantId!);
    await repairApprovalChains(ctx.tenantId!, ctx.userId);
    // ACCESS-P0-42: a group's tasks wait for each member.
    const [me, groupIds] = await Promise.all([getIdentityForUser(ctx.tenantId!, ctx.userId), activeGroupIdsOf(ctx.tenantId!, ctx.userId)]);
    [awaiting, myTasks] = await Promise.all([
      listRequestIdsAwaiting(ctx.tenantId!, { userId: ctx.userId, canApproveAsAccessManager: canApprove }),
      listFulfilmentTasks(ctx.tenantId!, { view: "todo", forPerson: { userId: ctx.userId, identityId: me?.id ?? null, canApprove, groupIds } }),
    ]);
  }
  // Without a choice: what waits for the caller, when anything does (or always for an approver); else their own.
  const view: View = asked ?? (awaiting.length || myTasks.length || canApprove ? "waiting" : "mine");
  const { rows, total } = await listRequests(ctx.tenantId!, {
    mineUserId: view === "mine" ? ctx.userId : undefined,
    awaiting: view === "waiting" ? { ids: awaiting, pendingAgentRequests: canApprove } : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const awaitingMe = new Set(awaiting);
  const progress = await requestProgressFor(ctx.tenantId!, rows.filter((r) => r.status === "approved" || r.status === "fulfilled").map((r) => r.id));
  const tasks = view === "waiting" ? myTasks : [];
  const waitingCount = awaiting.length + myTasks.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tabs: { key: View; label: string }[] = [
    { key: "waiting" as View, label: waitingCount ? `Waiting for you (${waitingCount})` : "Waiting for you" },
    { key: "mine", label: "My requests" },
    { key: "all", label: "All requests" },
  ];
  const href = (v: View, p = 1) => `/access/requests?view=${v}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Access Requests</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Requests for access, who they are for, how risky they are and where they stand. A person never decides their own request.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ObjectActionsMenu {...objectActionsFor(ctx.permissions, ["access-requests"])} />
          {ctx.permissions.includes("access.manage") ? (
            <LinkButton href="/access/request-policies" variant="outline" size="sm">
              Request policies
            </LinkButton>
          ) : null}
          {canRequest ? (
            <LinkButton href="/access/catalog" size="sm">
              Request access
            </LinkButton>
          ) : null}
        </div>
      </div>

      <Card className="p-4">
        <nav aria-label="Request views" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={t.key === view ? "page" : undefined}
              className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-sm", t.key === view ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {view === "waiting" ? (
          // ACCESS-P0-23: hand your approvals to someone while you are away.
          <p className="mt-2 text-xs text-muted-foreground">
            Away?{" "}
            <Link href="/access/delegations" className="text-primary hover:underline">
              Delegate your approvals
            </Link>
          </p>
        ) : null}
        {tasks.length ? (
          <section aria-label="Fulfilment tasks for you" className="mt-4">
            <h2 className="text-sm font-semibold text-foreground">Fulfilment tasks</h2>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {tasks.map((t) => {
                const label = taskLabel(t);
                const status = TASK_STATUS[t.status] ?? { label: t.status, tone: "neutral" as BadgeTone };
                return (
                  <li key={t.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
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
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {t.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                        <span>Account {accountLabel(t.accountName)} · due {when(t.dueAt)}</span>
                      </div>
                    </div>
                    <TaskActions taskId={t.id} status={t.status} mine={t.claimedBy === ctx.userId} label={label} />
                  </li>
                );
              })}
            </ul>
            {rows.length ? <h2 className="mt-5 text-sm font-semibold text-foreground">Approvals</h2> : null}
          </section>
        ) : null}
        <div className="mt-4">
          {rows.length === 0 ? (
            tasks.length ? null : (
              <EmptyState
                title={view === "waiting" ? "Nothing is waiting for you" : view === "mine" ? "You have no requests" : "No access requests yet"}
                description={view === "mine" && canRequest ? "Find what you need in the request catalog." : undefined}
              />
            )
          ) : (
            <TableContainer label="Access requests" bare>
              <Thead>
                <tr>
                  <Th>Access</Th>
                  <Th>For</Th>
                  <Th>Status</Th>
                  <Th hideBelow="lg">Risk</Th>
                  <Th hideBelow="xl">Requested</Th>
                  <Th>Actions</Th>
                </tr>
              </Thead>
              <tbody>
                {rows.map((r) => {
                  const mine = r.requestedBy === ctx.userId;
                  const state = lineState(r, progress.get(r.id)?.progress, undefined, progress.get(r.id)?.removal);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/access/requests/${r.ref ?? r.id}`} className="font-medium text-foreground hover:underline">
                          {r.packageName ?? r.applicationName ?? "Application"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {r.requestNumber ? <span className="font-mono">{r.requestNumber} · </span> : null}
                          {r.accessPackageId ? "Access package" : (r.entitlementName ?? "Application access")}
                        </span>
                      </Td>
                      <Td>
                        {r.subjectIdentityId ? (
                          <Link href={`/identities/${r.subjectIdentityId}`} className="hover:underline">
                            {r.subjectName ?? "Unknown identity"}
                          </Link>
                        ) : r.agentId ? (
                          <Link href={`/agents/${r.agentId}`} className="hover:underline">
                            An AI agent
                          </Link>
                        ) : (
                          "—"
                        )}
                        {mine ? <span className="block text-xs text-muted-foreground">Requested by you</span> : null}
                      </Td>
                      <Td>
                        <Badge tone={state.tone} className="whitespace-nowrap">
                          {state.label}
                        </Badge>
                        {r.status === "pending" && r.approvalStage ? <span className="mt-0.5 block text-xs text-muted-foreground">Stage {r.approvalStage}</span> : null}
                        {r.requestedExpiry && ["pending", "approved", "fulfilled"].includes(r.status) ? <span className="mt-0.5 block text-xs text-muted-foreground">Until {when(r.requestedExpiry)}</span> : null}
                      </Td>
                      <Td hideBelow="lg">{r.riskLevel ? <Badge tone={RISK_TONE[r.riskLevel]} className="whitespace-nowrap">{r.riskLevel}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td hideBelow="xl">
                        {when(r.createdAt)}
                        {r.justification ? <span className="block max-w-[18rem] truncate text-xs text-muted-foreground">{r.justification}</span> : null}
                      </Td>
                      <Td>
                        <RequestActions
                          requestId={r.id}
                          catalog={Boolean(r.subjectIdentityId)}
                          canCancel={mine && r.status === "pending" && canRequest}
                          canDecide={r.status === "pending" && (r.subjectIdentityId ? awaitingMe.has(r.id) : canApprove)}
                          canFulfil={canApprove && r.status === "approved"}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </div>
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
          <span className="text-muted-foreground">
            {total} {total === 1 ? "request" : "requests"}
            {pageCount > 1 ? ` · page ${Math.min(page, pageCount)} of ${pageCount}` : ""}
          </span>
          {pageCount > 1 ? (
            <span className="flex gap-2">
              {page > 1 ? (
                <LinkButton href={href(view, page - 1)} variant="outline" size="sm">
                  Previous
                </LinkButton>
              ) : null}
              {page < pageCount ? (
                <LinkButton href={href(view, page + 1)} variant="outline" size="sm">
                  Next
                </LinkButton>
              ) : null}
            </span>
          ) : null}
        </nav>
      </Card>
    </div>
  );
}
