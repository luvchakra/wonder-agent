import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  checkPackageEligibility,
  getPackage,
  listAssignments,
  listEntitlementsForApplication,
  listLiveApplications,
  sweepPackageExpiry,
} from "@/modules/access-governance/service";
import { getIdentityForUser, listAccountableHumans, listIdentities } from "@/modules/agent-identity/service";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass, Button } from "@/modules/ui";
import { APPROVAL, ASSIGNMENT, ITEM, RISK_TONE, STATUS_TONE } from "../labels";
import { AssignForm, ItemActions, PackageForm, PackageRequestForm, RemoveResource, ResourceForm, RevokeForm, StatusButtons } from "../PackageForms";

// ACCESS-P0-20 — one access package (spec §12.2): what it includes and how
// risky that is; whether you are eligible and why; who will approve and
// for how long; the request; and, for access managers, its contents,
// policy, status, direct assignment and every assignment with its work
// items — failures and revocation work stay visible.

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);
const TYPE_LABEL: Record<string, string> = { HUMAN: "people", EXTERNAL: "external identities", MACHINE: "machine identities", AI_AGENT: "AI agents" };

export default async function PackagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ find?: string; app?: string; page?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { id } = await params;
  const sp = await searchParams;
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const canApprove = ctx.permissions.includes("access.approve");
  const canRequest = ctx.permissions.includes("access.request");
  const find = (sp.find ?? "").slice(0, 100);
  await sweepPackageExpiry(tenantId);
  const [pkg, me] = await Promise.all([getPackage(tenantId, id), getIdentityForUser(tenantId, ctx.userId)]);
  if (!pkg) notFound();
  // Discoverability (spec §12.3): outside the managers, only eligible identities see a package that is live.
  const myEligibility = me ? checkPackageEligibility(pkg, { identityType: me.identityType, department: me.department, status: me.status }) : { eligible: false, reasons: ["Your account has no identity in this organization"] };
  if (!canManage && (pkg.status !== "active" || !pkg.requestable || !myEligibility.eligible)) notFound();

  const selectedApp = canManage && sp.app ? sp.app : null;
  const [assignments, found, owners, liveApps, appEntitlements] = await Promise.all([
    // Holders are visible to those who manage or fulfil access and to the package's owner; anyone else sees only their own.
    listAssignments(tenantId, {
      packageId: pkg.id,
      ...(canManage || canApprove || (me && pkg.ownerIdentityId === me.id) ? {} : { identityId: me?.id ?? "none" }),
      page: Math.max(1, Number(sp.page) || 1),
      pageSize: 25,
    }),
    find ? listIdentities(tenantId, { types: pkg.eligibleIdentityTypes as never, status: "active", q: find, pageSize: 20 }) : Promise.resolve({ rows: [], total: 0 }),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
    canManage && pkg.status !== "retired" ? listLiveApplications(tenantId) : Promise.resolve([]),
    selectedApp ? listEntitlementsForApplication(tenantId, selectedApp) : Promise.resolve([]),
  ]);
  const people = found.rows.filter((p) => p.id !== me?.id).map((p) => ({ id: p.id, label: `${p.displayName}${p.email ? ` (${p.email})` : ""}` }));
  const requestable = pkg.status === "active" && pkg.requestable && canRequest;
  const iHoldIt = assignments.rows.some((a) => a.identityId === me?.id && ["provisioning", "active", "partially_failed"].includes(a.status));

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href={canManage ? "/access/packages?view=manage" : "/access/packages"} className="hover:text-foreground hover:underline">
          Access packages
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{pkg.name}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">{pkg.name}</h1>
          {pkg.description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{pkg.description}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">
            Owner: {pkg.ownerName ?? "none yet"} · for {pkg.eligibleIdentityTypes.map((t) => TYPE_LABEL[t] ?? t).join(", ")}
            {pkg.eligibleDepartments.length ? ` in ${pkg.eligibleDepartments.join(", ")}` : ""} · certified {pkg.certificationFrequency === "none" ? "never" : pkg.certificationFrequency}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS_TONE[pkg.status]} className="whitespace-nowrap">
            {pkg.status}
          </Badge>
          <Badge tone={RISK_TONE[pkg.risk]} className="whitespace-nowrap">
            {pkg.risk} risk
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="What it includes" description="Granted together when the package is assigned, and removed together when it ends." />
          <CardBody>
            {pkg.resources.length ? (
              <ul className="divide-y divide-border">
                {pkg.resources.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{r.applicationName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.entitlementName ?? "Application access"}
                        {r.privilegeLevel && r.privilegeLevel !== "standard" ? ` · ${r.privilegeLevel}` : ""}
                        {!r.applicationLive ? " · application no longer live" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={RISK_TONE[r.risk]} className="whitespace-nowrap">
                        {r.risk}
                      </Badge>
                      {canManage && pkg.status !== "retired" ? <RemoveResource packageId={pkg.id} resourceId={r.id} label={`${r.applicationName} ${r.entitlementName ?? ""}`.trim()} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing included yet" description={canManage ? "Add an application's access or one of its entitlements below." : undefined} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Request" />
          <CardBody className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">You</dt>
                <dd className={myEligibility.eligible ? "text-success" : "text-foreground"}>{myEligibility.eligible ? "Eligible" : `Not eligible: ${myEligibility.reasons.join("; ")}`}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Approval</dt>
                <dd className="text-foreground">
                  {APPROVAL[pkg.approval]}
                  {pkg.approval === "manager_and_owner" ? (pkg.approvalMode === "parallel" ? ", at the same time" : ", in that order") : ""}
                  {pkg.risk === "critical" ? ", then an access manager" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Expires</dt>
                <dd className="text-foreground">
                  {pkg.maxDurationDays ? `After at most ${pkg.maxDurationDays} days${pkg.defaultDurationDays ? ` (${pkg.defaultDurationDays} by default)` : ""}` : "Not automatically"}
                  {pkg.extensionAllowed ? "; may be extended" : ""}
                </dd>
              </div>
            </dl>
            {iHoldIt ? <p className="rounded-md border border-border bg-muted/40 p-2 text-sm text-foreground">You hold this package. You can still request it for someone else.</p> : null}
            {requestable ? (
              <>
                <form method="get" className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="find" className={fieldLabelClass}>
                      Request for someone else
                    </label>
                    <input id="find" name="find" defaultValue={find} placeholder="Name or email" className={fieldInputClass} />
                  </div>
                  <Button type="submit" variant="secondary">
                    Find
                  </Button>
                </form>
                <PackageRequestForm packageId={pkg.id} people={people} selfLabel={me ? `Me (${me.displayName})` : "Me"} maxDurationDays={pkg.maxDurationDays} defaultDurationDays={pkg.defaultDurationDays} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{pkg.status !== "active" ? `This package is ${pkg.status}; it cannot be requested.` : !pkg.requestable ? "Access managers assign this package; it is not requested." : "Your role cannot request access."}</p>
            )}
          </CardBody>
        </Card>
      </div>

      {canManage ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Package and policy" description="Changing what it includes means waiting requests need approval again." />
            <CardBody>
              <PackageForm
                packageId={pkg.id}
                people={owners.map((p) => ({ id: p.id, label: `${p.displayName}${p.email ? ` (${p.email})` : ""}` }))}
                defaults={pkg}
              />
            </CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Status" description="Active packages can be found, requested and assigned; retired ones cannot." />
              <CardBody>
                <StatusButtons packageId={pkg.id} status={pkg.status} />
              </CardBody>
            </Card>
            {pkg.status !== "retired" ? (
              <Card>
                <CardHeader title="Add to the package" />
                <CardBody>
                  <ResourceForm packageId={pkg.id} applications={liveApps} selectedApp={selectedApp} entitlements={appEntitlements.map((e) => ({ id: e.id, name: e.name }))} />
                </CardBody>
              </Card>
            ) : null}
            {pkg.status === "active" ? (
              <Card>
                <CardHeader title="Assign directly" description="Without a request — for example to an AI agent. Audited." />
                <CardBody>
                  <AssignForm packageId={pkg.id} candidates={found.rows.map((p) => ({ id: p.id, label: `${p.displayName}${p.email ? ` (${p.email})` : ""}` }))} maxDurationDays={pkg.maxDurationDays} />
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Assignments</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Each included item is granted, or its failure recorded; when an assignment ends, what was granted becomes work to remove.</p>
        <div className="mt-3">
          {assignments.rows.length ? (
            <TableContainer label="Package assignments" bare>
              <Thead>
                <tr>
                  <Th>Holder</Th>
                  <Th>Status</Th>
                  <Th hideBelow="lg">Until</Th>
                  <Th>Items</Th>
                </tr>
              </Thead>
              <tbody>
                {assignments.rows.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`/identities/${a.identityId}`} className="font-medium text-foreground hover:underline">
                        {a.identityName ?? "Identity"}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {a.source === "request" && a.requestId ? (
                          <Link href={`/access/requests/${a.requestId}`} className="hover:underline">
                            From a request
                          </Link>
                        ) : (
                          "Assigned directly"
                        )}
                        {" · "}
                        {when(a.startsAt)}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={ASSIGNMENT[a.status]?.tone ?? "neutral"} className="whitespace-nowrap">
                        {ASSIGNMENT[a.status]?.label ?? a.status}
                      </Badge>
                      {a.endReason ? <span className="mt-0.5 block max-w-[14rem] text-xs text-muted-foreground">{a.endReason}</span> : null}
                    </Td>
                    <Td hideBelow="lg">{a.endedAt ? `Ended ${when(a.endedAt)}` : a.expiresAt ? when(a.expiresAt) : "No end date"}</Td>
                    <Td>
                      <ul className="space-y-2">
                        {a.items.map((i) => (
                          <li key={i.id} className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-sm text-foreground">
                                {i.applicationName}
                                <span className="text-muted-foreground"> · {i.entitlementName ?? "application access"}</span>
                              </span>
                              <span className="ml-2">
                                <Badge tone={ITEM[i.status]?.tone ?? "neutral"} className="whitespace-nowrap">
                                  {ITEM[i.status]?.label ?? i.status}
                                </Badge>
                              </span>
                              {i.detail ? <span className="block text-xs text-muted-foreground">{i.detail}</span> : null}
                            </div>
                            {canApprove ? <ItemActions packageId={pkg.id} itemId={i.id} status={i.status} label={`${i.applicationName} ${i.entitlementName ?? ""}`.trim()} /> : null}
                          </li>
                        ))}
                      </ul>
                      {canManage && ["provisioning", "active", "partially_failed"].includes(a.status) ? (
                        <div className="mt-2 border-t border-border pt-2">
                          <RevokeForm packageId={pkg.id} assignmentId={a.id} />
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          ) : (
            <EmptyState title="Nobody holds this package yet" />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {assignments.total} {assignments.total === 1 ? "assignment" : "assignments"}
          </p>
        </div>
      </Card>
    </div>
  );
}
