import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { getRogueFinding, remediationLabel } from "@/modules/risk/service";
import { listAssignments } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, SeverityBadge } from "@/modules/ui";
import { RemoveRogueAccessButton } from "../../../access/accounts/[id]/RemoveRogueAccessButton";
import { CloseRogueFinding } from "../../../access/accounts/[id]/CloseRogueFinding";
import { FindingOwnerActions } from "./FindingOwnerActions";

export const metadata = { title: "Rogue access finding" };

const OPEN = ["open", "acknowledged", "investigating", "assigned", "remediation_in_progress"];
const RESOLUTION: Record<string, string> = {
  verified_fixed: "Removed, verified on the system",
  approved_afterwards: "Approved afterwards",
  false_positive: "Not rogue (false positive)",
  accepted_risk: "Risk accepted",
};
const EVIDENCE: Record<string, string> = { access_grant: "Access found on the system", access_request: "Request", account: "Account" };
const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/**
 * RISK-P0-13 — one rogue-access finding: why it is rogue (the severity's
 * own reasons), its evidence, what was decided, and what can be done:
 * remove it (the main action), or approve it afterwards, recognize it as
 * legacy, accept an exception or close it as a false positive (folded),
 * give it an owner, or escalate it into an investigation.
 */
export default async function RogueFindingPage({ params }: { params: Promise<{ findingId: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("risk.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { findingId } = await params;
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("risk.manage");
  const [finding, members] = await Promise.all([getRogueFinding(tenantId, findingId), canManage ? listTenantMembersWithRoles(tenantId) : Promise.resolve([])]);
  if (!finding) notFound();
  // Packages the identity holds, to cover the access by one (needs access.manage too).
  const packages =
    canManage && ctx.permissions.includes("access.manage") && finding.identityId && OPEN.includes(finding.status)
      ? [
          ...new Map(
            (await listAssignments(tenantId, { identityId: finding.identityId, live: true, pageSize: 50 })).rows.map((a) => [a.packageId, { id: a.packageId, name: a.packageName ?? "Package" }]),
          ).values(),
        ]
      : [];

  const isOpen = OPEN.includes(finding.status);
  const remediation = remediationLabel(finding.remediationRequestStatus);
  const canRequestRemoval = isOpen && (!finding.remediationRequestStatus || ["rejected", "cancelled", "expired"].includes(finding.remediationRequestStatus));
  const memberOptions = members.map((m) => ({ userId: m.userId, label: m.displayName?.trim() || m.email }));
  const owner = finding.assignedTo ? (memberOptions.find((m) => m.userId === finding.assignedTo)?.label ?? "Former member") : null;

  return (
    <div className="space-y-6">
      <Link href="/risk/rogue-accounts" className="text-sm font-medium text-primary hover:underline">
        ← Rogue accounts
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-xs text-muted-foreground">{finding.ticketNumber ?? "Rogue access"}</p>
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{finding.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <Badge tone={isOpen ? "warning" : "neutral"} className="capitalize">
              {finding.status.replace(/_/g, " ")}
            </Badge>
            {remediation ? <Badge tone="info">{remediation}</Badge> : null}
            {owner ? <span className="text-xs text-muted-foreground">Owner: {owner}</span> : null}
          </div>
        </div>
        {canManage && canRequestRemoval ? <RemoveRogueAccessButton findingId={finding.id} what="this access" disable={!finding.entitlementId} /> : null}
      </div>

      <Card>
        <CardHeader title="Why it is rogue" description={`Found ${fmt(finding.createdAt)}${finding.riskScore !== null ? ` · score ${finding.riskScore}` : ""}`} />
        <CardBody className="space-y-3 text-sm">
          <p className="text-foreground">{finding.explanation}</p>
          {finding.reasons.length ? (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {finding.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p>
            <Link href={`/access/accounts/${finding.accountId}`} className="font-medium text-primary hover:underline">
              Open the account →
            </Link>
          </p>
        </CardBody>
      </Card>

      {!isOpen ? (
        <Card>
          <CardHeader title="Outcome" />
          <CardBody className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              {finding.status === "exception"
                ? `Accepted as an exception${finding.exceptionUntil ? ` until ${finding.exceptionUntil.slice(0, 10)}` : ""}`
                : (RESOLUTION[finding.resolutionType ?? ""] ?? finding.status.replace(/_/g, " "))}
            </p>
            {finding.resolutionReason || finding.decisionReason ? <p className="text-muted-foreground">{finding.resolutionReason ?? finding.decisionReason}</p> : null}
            {finding.resolvedAt ? <p className="text-xs text-muted-foreground">{fmt(finding.resolvedAt)}</p> : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Evidence" />
        {finding.evidence.length ? (
          <ul className="divide-y divide-border">
            {finding.evidence.map((e, i) => (
              <li key={`${e.type}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{EVIDENCE[e.type] ?? e.type.replace(/_/g, " ")}</span>
                  {e.summary ? <span className="text-muted-foreground"> · {e.summary}</span> : null}
                </span>
                {e.type === "access_request" && e.referenceId ? (
                  <Link href={`/access/requests/${e.referenceId}`} className="text-primary hover:underline">
                    Open
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">{fmt(e.createdAt)}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No evidence recorded.</p>
        )}
      </Card>

      {canManage && isOpen ? (
        <Card>
          <CardHeader title="Work on it" description="Assign an owner, escalate into an investigation, or decide another outcome." />
          <CardBody className="space-y-4">
            <FindingOwnerActions findingId={finding.id} assignedTo={finding.assignedTo} members={memberOptions} />
            <CloseRogueFinding findingId={finding.id} packages={packages} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
