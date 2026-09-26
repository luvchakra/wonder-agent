import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getRequestWithApprovals, listRequestIdsAwaiting, sweepApprovalTimeouts, type ApprovalView } from "@/modules/access-governance/service";
import { Badge, type BadgeTone, Card, CardBody, CardHeader } from "@/modules/ui";
import { RequestActions } from "../RequestActions";

// ACCESS-P0-19 — one access request and its approval chain (spec §11.1
// "see approval chain"): each stage, who it asks and why, who decided and
// when, and what an approval was valid for. Steps invalidated by a change
// to the request stay on record, below the live chain.

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  fulfilled: { label: "Fulfilled", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};
const STEP: Record<string, { label: string; tone: BadgeTone }> = {
  waiting: { label: "Not yet", tone: "neutral" },
  pending: { label: "Deciding now", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  skipped: { label: "Not needed", tone: "neutral" },
  expired: { label: "Timed out", tone: "danger" },
  invalidated: { label: "Invalidated", tone: "neutral" },
};
const KIND: Record<string, string> = {
  manager: "Manager",
  entitlement_owner: "Entitlement owner",
  application_owner: "Application owner",
  access_managers: "Any access manager",
};
const RISK_TONE: Record<string, BadgeTone> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null);

function Step({ s }: { s: ApprovalView }) {
  return (
    <li className="rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {KIND[s.approverKind] ?? s.approverKind}
            {s.approverKind !== "access_managers" && s.approverName ? <span className="font-normal text-muted-foreground"> · {s.approverName}</span> : null}
          </p>
          {s.reason ? <p className="mt-0.5 text-xs text-muted-foreground">{s.reason}</p> : null}
        </div>
        <Badge tone={STEP[s.status]?.tone ?? "neutral"} className="shrink-0 whitespace-nowrap">
          {STEP[s.status]?.label ?? s.status}
        </Badge>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        {s.decidedAt ? (
          <div>
            <dt className="inline">Decided: </dt>
            <dd className="inline text-foreground">
              {when(s.decidedAt)}
              {s.decidedByName ? ` by ${s.decidedByName}` : ""}
            </dd>
          </div>
        ) : s.status === "pending" && s.dueAt ? (
          <div>
            <dt className="inline">Due: </dt>
            <dd className="inline text-foreground">{when(s.dueAt)}</dd>
          </div>
        ) : null}
        {s.escalatedAt ? (
          <div>
            <dt className="inline">Escalated: </dt>
            <dd className="inline text-foreground">{when(s.escalatedAt)}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="inline">Valid for: </dt>
          <dd className="inline break-all font-mono text-[11px]" title="The action fingerprint this step was opened under">
            {s.actionFingerprint.slice(0, 16)}…
          </dd>
        </div>
      </dl>
      {s.comment ? <p className="mt-2 whitespace-pre-wrap rounded bg-muted px-2 py-1.5 text-xs text-foreground">{s.comment}</p> : null}
    </li>
  );
}

export default async function AccessRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { id } = await params;
  const tenantId = ctx.tenantId!;
  const canApprove = ctx.permissions.includes("access.approve");
  await sweepApprovalTimeouts(tenantId);
  const [found, awaiting] = await Promise.all([
    getRequestWithApprovals(tenantId, id),
    listRequestIdsAwaiting(tenantId, { userId: ctx.userId, canApproveAsAccessManager: canApprove }),
  ]);
  if (!found) notFound();
  const { request: r, steps } = found;
  const live = steps.filter((s) => s.status !== "invalidated");
  const invalidated = steps.filter((s) => s.status === "invalidated");
  const stages = [...new Set(live.map((s) => s.stage))].sort((a, b) => a - b);
  const mine = r.requestedBy === ctx.userId;
  const catalog = Boolean(r.subjectIdentityId);
  const canDecide = r.status === "pending" && (catalog ? awaiting.includes(r.id) : canApprove && !mine);
  const checks = r.policyResult?.checks ?? [];

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access/requests" className="hover:text-foreground hover:underline">
          Access Requests
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Request</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">
            {found.applicationName ?? "Application"}
            <span className="text-muted-foreground"> · {found.entitlementName ?? "Application access"}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For{" "}
            {r.subjectIdentityId ? (
              <Link href={`/identities/${r.subjectIdentityId}`} className="font-medium text-foreground hover:underline">
                {found.subjectName ?? "an identity"}
              </Link>
            ) : r.agentId ? (
              <Link href={`/agents/${r.agentId}`} className="font-medium text-foreground hover:underline">
                an AI agent
              </Link>
            ) : (
              "—"
            )}
            {mine ? " · requested by you" : ""} · {when(r.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS[r.status]?.tone ?? "neutral"} className="whitespace-nowrap">
            {STATUS[r.status]?.label ?? r.status}
          </Badge>
          {r.riskLevel ? (
            <Badge tone={RISK_TONE[r.riskLevel]} className="whitespace-nowrap">
              {r.riskLevel} risk
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Approval chain"
            description={
              catalog
                ? "Stages run in order; the approvers within a stage decide independently. Nobody decides their own request."
                : "An agent's request is decided by an access manager."
            }
          />
          <CardBody>
            {catalog && live.length ? (
              <ol className="space-y-4">
                {stages.map((stage) => (
                  <li key={stage}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Stage {stage}
                      {r.status === "pending" && r.approvalStage === stage ? " · current" : ""}
                    </p>
                    <ul className="space-y-2">
                      {live
                        .filter((s) => s.stage === stage)
                        .map((s) => (
                          <Step key={s.id} s={s} />
                        ))}
                    </ul>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                {catalog
                  ? r.status === "pending"
                    ? "The approvers are being worked out; this chain appears as soon as they are."
                    : "This request needed no approval: the request policy approved it automatically."
                  : r.decidedAt
                    ? `Decided ${when(r.decidedAt)}.`
                    : "Waiting for an access manager."}
              </p>
            )}
            {invalidated.length ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  {invalidated.length} earlier {invalidated.length === 1 ? "step" : "steps"} invalidated when the request changed
                </summary>
                <ul className="mt-2 space-y-2">
                  {invalidated.map((s) => (
                    <Step key={s.id} s={s} />
                  ))}
                </ul>
              </details>
            ) : null}
            {/* Always mounted, so the outcome of a decision stays on screen after the page refreshes. */}
            <div className="mt-4 border-t border-border pt-4 empty:hidden">
              <RequestActions
                requestId={r.id}
                catalog={catalog}
                canCancel={mine && r.status === "pending" && ctx.permissions.includes("access.request")}
                canDecide={canDecide}
                canFulfil={canApprove && r.status === "approved"}
                withComment
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Request" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Why</dt>
                <dd className="whitespace-pre-wrap text-foreground">{r.justification || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">For how long</dt>
                <dd className="text-foreground">
                  {r.durationDays ? `${r.durationDays} days` : "No end date"}
                  {r.requestedExpiry ? ` · until ${when(r.requestedExpiry)}` : ""}
                </dd>
              </div>
              {checks.length ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Policy checks when submitted</dt>
                  <dd>
                    <ul className="mt-1 space-y-1 text-xs">
                      {checks.map((c) => (
                        <li key={c.check} className="flex justify-between gap-3">
                          <span className="text-muted-foreground">{c.check}</span>
                          <span className="text-right text-foreground">{c.result}</span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
