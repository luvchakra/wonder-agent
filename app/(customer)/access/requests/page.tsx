import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRequestIdsAwaiting, listRequests, repairApprovalChains, sweepApprovalTimeouts } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, type BadgeTone, Card, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { RequestActions } from "./RequestActions";

// ACCESS-P0-18 — access requests: the caller's own, those waiting for a
// decision, or all, paged at the database (§15). Requests for people and
// other identities (the request catalog) and agent requests share the list.
// ACCESS-P0-19 — "waiting for you" is what the caller may decide now: a
// step of a catalog request that names them (a manager or owner needs no
// approver role), a step open to access managers, or, for access managers,
// a waiting agent request.

const PAGE_SIZE = 50;
const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  fulfilled: { label: "Fulfilled", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};
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
  if (asked === null || asked === "waiting") {
    // Steps past their time are escalated or expired, and waiting requests
    // without a chain get one, before anyone is shown what waits for them.
    await sweepApprovalTimeouts(ctx.tenantId!);
    await repairApprovalChains(ctx.tenantId!, ctx.userId);
    awaiting = await listRequestIdsAwaiting(ctx.tenantId!, { userId: ctx.userId, canApproveAsAccessManager: canApprove });
  }
  // Without a choice: what waits for the caller, when anything does (or always for an approver); else their own.
  const view: View = asked ?? (awaiting.length || canApprove ? "waiting" : "mine");
  const { rows, total } = await listRequests(ctx.tenantId!, {
    mineUserId: view === "mine" ? ctx.userId : undefined,
    awaiting: view === "waiting" ? { ids: awaiting, pendingAgentRequests: canApprove } : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const awaitingMe = new Set(awaiting);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tabs: { key: View; label: string }[] = [
    { key: "waiting" as View, label: "Waiting for you" },
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
        <div className="flex flex-wrap gap-2">
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
        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title={view === "waiting" ? "Nothing is waiting for you" : view === "mine" ? "You have no requests" : "No access requests yet"}
              description={view === "mine" && canRequest ? "Find what you need in the request catalog." : undefined}
            />
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
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/access/requests/${r.id}`} className="font-medium text-foreground hover:underline">
                          {r.packageName ?? r.applicationName ?? "Application"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{r.accessPackageId ? "Access package" : (r.entitlementName ?? "Application access")}</span>
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
                        <Badge tone={STATUS[r.status]?.tone ?? "neutral"} className="whitespace-nowrap">{STATUS[r.status]?.label ?? r.status}</Badge>
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
                          canDecide={r.status === "pending" && (r.agentId ? canApprove : awaitingMe.has(r.id))}
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
