import Link from "next/link";
import { getRecordProvenance } from "@/lib/provenance/recordProvenance";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getAccountAccessLedger, getInventoryAccount, LEDGER_SOURCE_LABEL, LEDGER_STATUS_LABEL, type LedgerStatus } from "@/modules/access-governance/service";
import { listAccessFindings, remediationLabel } from "@/modules/risk/service";
import { listIdentities } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { RecordProvenance, Badge, Button, Card, CardBody, CardHeader, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { LinkAccountForm } from "../AccountForms";
import { RemoveRogueAccessButton } from "./RemoveRogueAccessButton";
import { ACCOUNT_TYPE_LABEL, CORRELATION_LABEL, IDENTITY_TYPE_LABEL, when } from "../labels";

// ACCESS-P0-17 — one account: who it belongs to and how that was decided,
// its application, use and source; linking it to an identity by hand.

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function AccountDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ find?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { id } = await params;
  const find = ((await searchParams).find ?? "").slice(0, 100);
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const canRemediate = ctx.permissions.includes("risk.manage");
  const [account, provenance, ledger, findings] = await Promise.all([
    getInventoryAccount(tenantId, id),
    getRecordProvenance(tenantId, "accounts", id),
    // ACCESS-P0-25: whether WonderID can prove each piece of this account's access was approved.
    getAccountAccessLedger(tenantId, id).catch(() => null),
    listAccessFindings(tenantId, { accountId: id, openOnly: true }).catch(() => []),
  ]);
  if (!account) notFound();
  // One ticket per rogue account (0132): open while any of its rogue access is.
  const openTicket = findings.find((f) => f.ticketStatus === "open" && f.ticketNumber)?.ticketNumber ?? null;
  const identities =
    canManage && !account.agentId
      ? (await listIdentities(tenantId, { types: ["HUMAN", "EXTERNAL", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"], status: "active", q: find || undefined, pageSize: 50 })).rows
      : [];
  const corr = CORRELATION_LABEL[account.correlation];
  const title = account.accountName ?? account.externalAccountRef;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access/accounts" className="hover:text-foreground hover:underline">
          Accounts
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{title}</span>
      </nav>
      <div>
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">{title}</h1>
        <RecordProvenance record={provenance} className="mt-1" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={corr.tone}>{corr.label}</Badge>
          <Badge tone={account.status === "active" ? "success" : "neutral"}>{account.status === "active" ? "Active" : "Disabled"}</Badge>
          {account.accountType !== "standard" ? <Badge tone="warning">{ACCOUNT_TYPE_LABEL[account.accountType]}</Badge> : null}
          {account.dormant && account.status === "active" ? <Badge tone="warning">Dormant</Badge> : null}
          {account.missingFromSourceAt ? <Badge tone="warning">Missing from source since {when(account.missingFromSourceAt)}</Badge> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Identifier">
                <span className="font-mono text-xs">{account.externalAccountRef}</span>
              </Detail>
              <Detail label="Application">
                <Link href={`/access/applications/${account.applicationId}`} className="text-primary hover:underline">
                  {account.applicationName}
                </Link>
              </Detail>
              <Detail label="Belongs to">
                {account.identityId ? (
                  <Link href={account.agentId ? `/agents/${account.agentId}` : `/identities/${account.identityId}`} className="text-primary hover:underline">
                    {account.identityName ?? "Unknown identity"}
                  </Link>
                ) : (
                  <span className="text-destructive">No identity</span>
                )}
                {account.identityType ? <span className="block text-xs text-muted-foreground">{IDENTITY_TYPE_LABEL[account.identityType]}</span> : null}
              </Detail>
              <Detail label="How it was matched">
                {account.agentId
                  ? "The agent's own account"
                  : account.correlation === "manual"
                    ? "Linked by hand"
                    : account.correlation === "correlated"
                      ? "The correlation rule"
                      : account.correlation === "ambiguous"
                        ? "More than one identity matched"
                        : "Nothing matched"}
              </Detail>
              <Detail label="Last used">{when(account.lastUsedAt) ?? "Never recorded"}</Detail>
              <Detail label="Last seen in the source">{when(account.lastSeenAt)}</Detail>
              <Detail label="Recorded">{account.source === "reconciliation" ? `By reconciliation, ${when(account.createdAt)}` : when(account.createdAt)}</Detail>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Owner"
            description={account.agentId ? "An AI agent's accounts are managed from the agent." : "A link made here is kept by later reconciliation runs."}
          />
          <CardBody>
            {account.agentId ? (
              <Link href={`/agents/${account.agentId}`} className="text-sm text-primary hover:underline">
                Open the agent
              </Link>
            ) : canManage ? (
              <div className="space-y-4">
                <form method="get" className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="find" className={fieldLabelClass}>
                      Find an identity
                    </label>
                    <input id="find" name="find" type="search" defaultValue={find} placeholder="Name or email" className={fieldInputClass} />
                  </div>
                  <Button type="submit" variant="secondary">
                    Find
                  </Button>
                </form>
                {!find ? <p className="text-xs text-muted-foreground">Showing the first 50 identities by name; search to narrow them.</p> : null}
              <LinkAccountForm
                accountId={account.id}
                currentIdentityId={account.identityId}
                currentIdentityName={account.identityName}
                identities={identities.map((i) => ({ id: i.id, label: `${i.displayName}${i.email ? ` (${i.email})` : ""} · ${IDENTITY_TYPE_LABEL[i.identityType]}` }))}
              />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Someone who can manage access links accounts.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Access"
          description="Whether WonderID can prove each piece of this account's access was approved."
          actions={openTicket ? <Badge tone="danger">{`Ticket ${openTicket} open`}</Badge> : undefined}
        />
        <CardBody>
          {ledger === null ? (
            <p role="status" className="text-sm text-warning">The access record could not be read just now.</p>
          ) : ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet. Access appears after the application is reconciled.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {ledger.map((e) => {
                const finding = findings.find((f) => (f.entitlementId ?? null) === (e.entitlementId ?? null));
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 text-foreground">{e.entitlementName ?? "The account itself"}</span>
                    <Badge tone={STATUS_TONE[e.status]}>{LEDGER_STATUS_LABEL[e.status]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {LEDGER_SOURCE_LABEL[e.source]}
                      {e.lastVerifiedAt ? ` · last seen at source ${when(e.lastVerifiedAt)}` : ""}
                    </span>
                    {e.missingFromSourceAt ? <Badge tone="neutral">Gone from source</Badge> : null}
                    {finding ? <Badge tone="danger">Finding open</Badge> : null}
                    {finding && remediationLabel(finding.remediationRequestStatus) ? <Badge tone="info">{remediationLabel(finding.remediationRequestStatus)}</Badge> : null}
                    {finding && canRemediate && (!finding.remediationRequestStatus || ["rejected", "cancelled", "expired"].includes(finding.remediationRequestStatus)) ? (
                      <RemoveRogueAccessButton findingId={finding.id} what={e.entitlementName ?? "this account"} disable={!e.entitlementId} />
                    ) : null}
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

const STATUS_TONE: Record<LedgerStatus, "success" | "warning" | "danger" | "neutral"> = {
  VALID: "success",
  EXPIRED: "warning",
  REVOKED: "neutral",
  UNPROVEN: "warning",
  ROGUE: "danger",
  LEGACY_EXCEPTION: "neutral",
  PENDING_RECONCILIATION: "neutral",
};
