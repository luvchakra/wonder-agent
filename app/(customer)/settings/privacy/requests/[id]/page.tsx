import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { getRequest } from "@/modules/privacy/service";
import { REGIME_LABEL, REQUEST_TYPE_LABEL, deadlineState, maxExtendedDueAt, requiresApproval } from "@/modules/privacy/rules";
import { advanceRequestAction } from "@/app/actions/privacy";
import { PrivacyForm } from "../../PrivacyForm";

// COMPLIANCE-P0-12 — one rights request: its statutory deadline, identity
// verification, extension, and the step that closes it. Erasure is
// prepared by one person and approved (and executed) by another.

export const metadata = { title: "Privacy request" };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function PrivacyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("privacy.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const req = await getRequest(ctx.tenantId!, id);
  if (!req) notFound();
  const canProcess = ctx.permissions.includes("privacy.requests.process");
  const due = req.extendedDueAt ?? req.dueAt;
  const state = deadlineState(req.status, new Date(due), new Date());
  const open = !["completed", "rejected", "withdrawn"].includes(req.status);
  const maxExt = maxExtendedDueAt(req.regime, new Date(req.receivedAt));
  const hidden = <input type="hidden" name="requestId" value={req.id} />;

  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link href="/settings/privacy?tab=requests" className="text-primary hover:underline">
          ← Privacy requests
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-xl font-semibold text-foreground">{req.reference}</h1>
        <Badge tone={req.status === "completed" ? "success" : req.status === "rejected" ? "danger" : "info"}>{req.status.replace("_", " ")}</Badge>
        <Badge tone={state === "overdue" ? "danger" : state === "due_soon" ? "warning" : "neutral"}>{state === "closed" ? "Closed" : `Due ${fmt(due)}`}</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader title={REQUEST_TYPE_LABEL[req.requestType]} description={REGIME_LABEL[req.regime]} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Requester</dt>
                <dd className="text-foreground">
                  {req.subjectName ? `${req.subjectName} · ` : ""}
                  {req.subjectEmail}
                  {req.subjectUserId ? <Badge className="ml-1">Member</Badge> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Received</dt>
                <dd className="text-foreground">
                  {fmt(req.receivedAt)} via {req.channel.replace("_", " ")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Statutory deadline</dt>
                <dd className="text-foreground">
                  {fmt(req.dueAt)}
                  {req.extendedDueAt ? ` → extended to ${fmt(req.extendedDueAt)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Identity</dt>
                <dd className="text-foreground">{req.identityVerifiedAt ? `Verified ${fmt(req.identityVerifiedAt)} (${req.verificationMethod})` : "Not yet verified"}</dd>
              </div>
              {req.extensionReason ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Extension reason</dt>
                  <dd className="text-foreground">{req.extensionReason}</dd>
                </div>
              ) : null}
              {req.description ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Request</dt>
                  <dd className="whitespace-pre-wrap text-foreground">{req.description}</dd>
                </div>
              ) : null}
              {req.outcome ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Outcome</dt>
                  <dd className="text-foreground">
                    {req.outcome.replace("_", " ")} on {fmt(req.completedAt)}
                    {req.outcomeReason ? ` — ${req.outcomeReason}` : ""}
                  </dd>
                </div>
              ) : null}
              {Object.keys(req.result).length ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Result</dt>
                  <dd>
                    <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs text-foreground">{JSON.stringify(req.result, null, 2)}</pre>
                  </dd>
                </div>
              ) : null}
            </dl>
            {(req.requestType === "access" || req.requestType === "portability") && canProcess && req.identityVerifiedAt ? (
              <p className="mt-4">
                <a href={`/api/v1/privacy/requests/${req.id}/export`} className="text-sm font-medium text-primary hover:underline">
                  Download the requester&apos;s data (JSON, audited)
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>

        {canProcess && open ? (
          <div className="space-y-4">
            {!req.identityVerifiedAt ? (
              <Card>
                <CardHeader title="1. Verify identity" description="Before releasing or deleting anything (GDPR Art. 12(6))" />
                <CardBody>
                  <PrivacyForm action={advanceRequestAction} submitLabel="Record verification" pendingLabel="Saving…">
                    {hidden}
                    <input type="hidden" name="action" value="verify" />
                    <div>
                      <label htmlFor="rq-method" className={fieldLabelClass}>
                        How was it verified?
                      </label>
                      <input id="rq-method" name="method" required maxLength={200} placeholder="Reply from the registered work email" className={fieldInputClass} />
                    </div>
                  </PrivacyForm>
                </CardBody>
              </Card>
            ) : null}

            {req.status === "awaiting_approval" ? (
              <Card>
                <CardHeader title="Approve erasure" description="A second person checks and approves; approving runs the erasure." />
                <CardBody className="space-y-3">
                  {req.processedBy === ctx.userId ? (
                    <p className="text-sm text-muted-foreground">You prepared this erasure, so someone else must approve it.</p>
                  ) : (
                    <PrivacyForm action={advanceRequestAction} submitLabel="Approve and erase" pendingLabel="Erasing…" variant="destructive">
                      {hidden}
                      <input type="hidden" name="action" value="approve" />
                      <p className="text-sm text-foreground">
                        Removes the person from this organization, pseudonymises their identity records, consents and earlier requests, and deletes their notifications. The audit trail is kept unaltered (legal obligation). This cannot be undone.
                      </p>
                    </PrivacyForm>
                  )}
                  <PrivacyForm action={advanceRequestAction} submitLabel="Return for more work" pendingLabel="Returning…" variant="outline">
                    {hidden}
                    <input type="hidden" name="action" value="return_to_processing" />
                    <input name="note" placeholder="What needs checking" aria-label="Note" className={fieldInputClass} />
                  </PrivacyForm>
                </CardBody>
              </Card>
            ) : req.identityVerifiedAt ? (
              <Card>
                <CardHeader title="2. Respond" />
                <CardBody>
                  {requiresApproval(req.requestType) ? (
                    <PrivacyForm action={advanceRequestAction} submitLabel="Send for approval" pendingLabel="Sending…">
                      {hidden}
                      <input type="hidden" name="action" value="submit_for_approval" />
                      <p className="text-sm text-muted-foreground">Check nothing must be kept under another legal obligation, then send it to a second person to approve.</p>
                    </PrivacyForm>
                  ) : (
                    <PrivacyForm action={advanceRequestAction} submitLabel="Mark completed" pendingLabel="Saving…">
                      {hidden}
                      <input type="hidden" name="action" value="complete" />
                      <select name="outcome" aria-label="Outcome" className={fieldInputClass}>
                        <option value="fulfilled">Fulfilled in full</option>
                        <option value="partially_fulfilled">Partly fulfilled</option>
                      </select>
                      <textarea name="reason" rows={2} placeholder="What was done (and, if partial, what was withheld and why)" aria-label="Notes" className={fieldInputClass} />
                    </PrivacyForm>
                  )}
                </CardBody>
              </Card>
            ) : null}

            {maxExt && !req.extendedDueAt ? (
              <Card>
                <CardHeader title="Extend the deadline" description={`Once, within the original deadline, to ${maxExt.toISOString().slice(0, 10)} at the latest.`} />
                <CardBody>
                  <PrivacyForm action={advanceRequestAction} submitLabel="Extend" pendingLabel="Saving…" variant="outline">
                    {hidden}
                    <input type="hidden" name="action" value="extend" />
                    <input name="dueAt" type="date" required aria-label="New deadline" className={fieldInputClass} />
                    <textarea name="reason" required minLength={10} rows={2} placeholder="Why (complexity, number of requests); tell the requester" aria-label="Reason" className={fieldInputClass} />
                  </PrivacyForm>
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Refuse" description="Manifestly unfounded or excessive, or an exemption applies" />
              <CardBody>
                <PrivacyForm action={advanceRequestAction} submitLabel="Refuse request" pendingLabel="Saving…" variant="destructive">
                  {hidden}
                  <input type="hidden" name="action" value="reject" />
                  <textarea name="reason" required minLength={10} rows={2} placeholder="The reason, which the requester must be told with their right to complain" aria-label="Reason" className={fieldInputClass} />
                </PrivacyForm>
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
