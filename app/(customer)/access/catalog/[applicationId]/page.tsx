import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getRequestCatalogItem, withinContract } from "@/modules/access-governance/service";
import { getAgentContract, getIdentityForUser, listDirectReports, listIdentities, listOwnedIdentities } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Button, Card, CardBody, CardHeader, EmptyState, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { RequestForm, type RequestOption } from "../RequestForm";

// ACCESS-P0-18 — requesting one application's access, for yourself or
// (under the policy's scope) someone else. The server re-applies every
// rule on submit; this page only shows what the rules will say.

export default async function RequestAccessPage({ params, searchParams }: { params: Promise<{ applicationId: string }>; searchParams: Promise<{ entitlement?: string; find?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.request");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { applicationId } = await params;
  const sp = await searchParams;
  const tenantId = ctx.tenantId!;
  const find = (sp.find ?? "").slice(0, 100);
  const [item, me, found] = await Promise.all([
    getRequestCatalogItem(tenantId, applicationId),
    getIdentityForUser(tenantId, ctx.userId),
    find ? listIdentities(tenantId, { types: ["HUMAN", "EXTERNAL"], status: "active", q: find, pageSize: 20 }) : Promise.resolve({ rows: [], total: 0 }),
  ]);
  if (!item) notFound();
  // ACCESS-P0-31: what you own (service accounts, machine identities, agents) can be requested for too;
  // for an agent, only what its contract approves is offered (the server checks again).
  // EXPERIENCE-P0-29: and the people you manage, without searching.
  const [owned, reports] = await Promise.all([listOwnedIdentities(tenantId, ctx.userId, me?.id ?? null), listDirectReports(tenantId, me?.id ?? null)]);
  const contracts = await Promise.all(owned.map((o) => (o.agentId ? getAgentContract(o.agentId, tenantId) : Promise.resolve(null))));

  const options: RequestOption[] = [
    ...(item.appRequestable
      ? [
          {
            value: "",
            label: `${item.name} (application access)`,
            risk: item.risk,
            approval: item.approval,
            maxDurationDays: item.policy?.maxDurationDays ?? null,
            defaultDurationDays: item.policy?.defaultDurationDays ?? null,
            justificationRequired: item.policy?.justificationRequired ?? true,
          },
        ]
      : []),
    ...item.entitlements
      .filter((e) => e.requestable)
      .map((e) => ({
        value: e.id,
        label: e.name,
        risk: e.risk,
        approval: e.approval,
        maxDurationDays: e.policy?.maxDurationDays ?? null,
        defaultDurationDays: e.policy?.defaultDurationDays ?? null,
        justificationRequired: e.policy?.justificationRequired ?? true,
      })),
  ];
  const initial = options.find((o) => o.value === sp.entitlement)?.value ?? options[0]?.value ?? "";
  const known = new Set([me?.id, ...reports.map((r) => r.id), ...owned.map((o) => o.id)]);
  const people = [
    ...reports.map((p) => ({ id: p.id, label: `${p.displayName}${p.email ? ` (${p.email})` : ""}`, group: "People you manage" })),
    ...owned.map((o) => ({ id: o.id, label: `${o.displayName} (${o.agentId ? "your agent" : "you own"})`, group: "What you own" })),
    ...found.rows.filter((p) => !known.has(p.id)).map((p) => ({ id: p.id, label: `${p.displayName}${p.email ? ` (${p.email})` : ""}`, group: "Found" })),
  ];
  const dataOf = new Map(item.entitlements.map((e) => [e.id, e.dataClassification]));
  const withinAgentContract = Object.fromEntries(
    owned.flatMap((o, i) => {
      if (!o.agentId) return [];
      const contract = contracts[i];
      return [[o.id, contract ? options.filter((opt) => withinContract(contract, item.names, opt.value ? (dataOf.get(opt.value) ?? null) : null)).map((opt) => opt.value) : []]];
    }),
  );

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access/catalog" className="hover:text-foreground hover:underline">
          Request access
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{item.name}</span>
      </nav>
      <div>
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">Request {item.name}</h1>
        {item.description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{item.description}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Your request" />
          <CardBody>
            {options.length ? (
              <RequestForm
                applicationId={item.applicationId}
                options={options}
                initialOption={initial}
                people={people}
                withinAgentContract={withinAgentContract}
                selfLabel={me ? `Me (${me.displayName})` : "Me"}
              />
            ) : (
              <EmptyState title="Nothing here is requestable" description="A request policy decides what can be requested; ask an access manager." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Requesting for someone else" description="Their manager can request for them, as an owner can for a service account or agent; so can an access manager. Anyone else is refused." />
          <CardBody>
            <form method="get" className="space-y-2">
              {sp.entitlement ? <input type="hidden" name="entitlement" value={sp.entitlement} /> : null}
              <label htmlFor="find" className={fieldLabelClass}>
                Find a person
              </label>
              <div className="flex gap-2">
                <input id="find" name="find" type="search" defaultValue={find} placeholder="Name or email" className={fieldInputClass} />
                <Button type="submit" variant="secondary">
                  Find
                </Button>
              </div>
              {find ? <p className="text-xs text-muted-foreground">{people.length ? `${people.length} found; choose them under "For".` : "Nobody found."}</p> : null}
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
