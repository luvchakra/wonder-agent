import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getInventoryAccount } from "@/modules/access-governance/service";
import { listIdentities } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Button, Card, CardBody, CardHeader, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { LinkAccountForm } from "../AccountForms";
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
  const account = await getInventoryAccount(tenantId, id);
  if (!account) notFound();
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
    </div>
  );
}
