import Link from "next/link";
import { Suspense } from "react";
import { getRecordProvenance } from "@/lib/provenance/recordProvenance";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  getAccountSummary,
  getApplicationDetail,
  getOnboarding,
  listAccessReconciliationRuns,
  listEntitlementsForApplication,
  listEntitlementTypes,
  listFulfilmentAssignments,
  listReconciliationRuns,
} from "@/modules/access-governance/service";
import { listGroups } from "@/lib/users/groups";
import { FulfilmentAssignments } from "./FulfilmentAssignments";
import { EntitlementsPanel } from "./EntitlementsPanel";
import { OnboardingPanel } from "./onboarding/OnboardingPanel";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { getIntegration } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { RecordProvenance, Badge, Card, CardBody, CardHeader, KpiCard, LinkButton, Tabs, TabPanel } from "@/modules/ui";
import { ApplicationForm } from "../ApplicationForm";
import { APP_TYPE_LABEL, LEVEL_TONE, ONBOARDING_LABEL } from "../labels";
import { LifecycleForm } from "./onboarding/OnboardingForms";
import { ReconcileAccessForm, ReconcileAccountsForm } from "../../accounts/AccountForms";

// ACCESS-P0-15 — one application: catalog details, owners, classification,
// connector, and the access it holds. ACCESS-P0-16 adds its onboarding and
// the suspend / resume / retire lifecycle; ACCESS-P0-17 its accounts and
// their reconciliation. Sections are tabs (owner request, 2026-10-14);
// ?tab= opens one directly.

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function ApplicationDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const [{ id }, { tab: requestedTab }] = await Promise.all([params, searchParams]);
  const tenantId = ctx.tenantId!;
  const app = await getApplicationDetail(tenantId, id);
  if (!app) notFound();
  const canManage = ctx.permissions.includes("access.manage");
  const [entitlements, people, integration, onboarding, accountSummary, runs, provenance, accessRuns, entitlementTypes, assignments, groups] = await Promise.all([
    listEntitlementsForApplication(tenantId, id),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
    app.sourceIntegrationId && ctx.permissions.includes("integration.read") ? getIntegration(tenantId, app.sourceIntegrationId) : Promise.resolve(null),
    getOnboarding(tenantId, id),
    getAccountSummary(tenantId, { applicationId: id }),
    listReconciliationRuns(tenantId, id, 1),
    getRecordProvenance(tenantId, "applications", id),
    // EXPERIENCE-P0-28: the last applied entitlement and access reconciliation, if any.
    listAccessReconciliationRuns(tenantId, id, 10).catch(() => []),
    // ACCESS-P0-33: the application's entitlement types.
    listEntitlementTypes(tenantId, id),
    // ACCESS-P0-42: who does its fulfilment tasks.
    listFulfilmentAssignments(tenantId, id),
    canManage ? listGroups(tenantId).catch(() => []) : Promise.resolve([]),
  ]);
  const lastRun = runs[0] ?? null;
  const lastAccessRun = accessRuns.find((r) => !r.dryRun) ?? null;
  const lifecycleActions = (
    app.onboardingStatus === "ACTIVE" ? ["suspend", "retire"] : app.onboardingStatus === "SUSPENDED" ? ["resume", "retire"] : app.onboardingStatus === "RETIRED" ? [] : ["retire"]
  ) as ("suspend" | "resume" | "retire")[];
  const status = ONBOARDING_LABEL[app.onboardingStatus];
  const fromConnector = onboarding?.config.entitlementSource === "connector";
  const tabs = [
    { value: "details", label: "Details" },
    {
      value: "entitlements",
      label: "Entitlements",
      count: entitlements.length,
    },
    { value: "onboarding", label: "Onboarding" },
    { value: "accounts", label: "Accounts", count: accountSummary.total },
    ...(canManage ? [{ value: "settings", label: "Settings" }] : []),
  ];

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access" className="hover:text-foreground hover:underline">
          Applications
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{app.displayName ?? app.name}</span>
      </nav>
      <div>
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">{app.displayName ?? app.name}</h1>
        <RecordProvenance record={provenance} className="mt-1" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone="neutral">{APP_TYPE_LABEL[app.appType]}</Badge>
          {app.environment !== "production" ? <Badge tone="neutral">{cap(app.environment)}</Badge> : null}
          {app.isExternal ? <Badge tone="warning">External-facing</Badge> : null}
          {!app.businessOwnerIdentityId || !app.technicalOwnerIdentityId ? <Badge tone="warning">Owner missing</Badge> : null}
        </div>
        {app.description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{app.description}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard size="sm" icon="Users" tone="primary" label="Accounts" value={app.accountCount} />
        <KpiCard size="sm" icon="KeyRound" tone="violet" label="Entitlements" value={app.entitlementCount} />
        <KpiCard
          size="sm"
          icon="TriangleAlert"
          tone={app.riskLevel === "critical" || app.riskLevel === "high" ? "danger" : "neutral"}
          label="Risk"
          value={app.riskLevel ? cap(app.riskLevel) : "Not assessed"}
        />
        <KpiCard size="sm" icon="ShieldCheck" tone="neutral" label="Data" value={app.dataClassification ? cap(app.dataClassification) : "Not classified"} />
      </div>

      <Tabs tabs={tabs} ariaLabel="Application sections" defaultValue={tabs.some((t) => t.value === requestedTab) ? requestedTab : "details"}>
        <TabPanel value="details" className="pt-4">
          <Card>
            <CardBody>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Name">{app.name}</Detail>
                <Detail label="Vendor">{app.vendor}</Detail>
                <Detail label="Category">{app.category}</Detail>
                <Detail label="Business owner">
                  {app.businessOwnerIdentityId ? (
                    <Link href={`/identities/${app.businessOwnerIdentityId}`} className="text-primary hover:underline">
                      {app.businessOwnerName ?? "Unknown"}
                    </Link>
                  ) : null}
                </Detail>
                <Detail label="Technical owner">
                  {app.technicalOwnerIdentityId ? (
                    <Link href={`/identities/${app.technicalOwnerIdentityId}`} className="text-primary hover:underline">
                      {app.technicalOwnerName ?? "Unknown"}
                    </Link>
                  ) : null}
                </Detail>
                <Detail label="Criticality">{app.criticality ? <Badge tone={LEVEL_TONE[app.criticality]}>{cap(app.criticality)}</Badge> : null}</Detail>
                <Detail label="Environment">{cap(app.environment)}</Detail>
                <Detail label="Address">
                  {app.url ? (
                    <a href={app.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {app.url.replace(/^https:\/\//, "")}
                    </a>
                  ) : null}
                </Detail>
                <Detail label="Discovered from">{app.discoverySource === "manual" ? "Registered by hand" : cap(app.discoverySource)}</Detail>
                <Detail label="Connector">
                  {app.sourceIntegrationId ? (
                    integration ? (
                      <Link href={`/integrations/${integration.id}`} className="text-primary hover:underline">
                        {integration.name}
                      </Link>
                    ) : (
                      "Connected"
                    )
                  ) : (
                    "Not connected"
                  )}
                </Detail>
                <Detail label="Registered">
                  {new Date(app.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </Detail>
              </dl>
            </CardBody>
          </Card>
        </TabPanel>
        <TabPanel value="entitlements" className="pt-4">
          <EntitlementsPanel
            applicationId={id}
            entitlements={entitlements.slice(0, 200)}
            total={entitlements.length}
            types={entitlementTypes}
            canManage={canManage}
            fromConnector={fromConnector}
          />
        </TabPanel>
        <TabPanel value="onboarding" className="space-y-4 pt-4">
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading onboarding…</p>}>
            <OnboardingPanel app={app} ctx={{ tenantId, userId: ctx.userId, permissions: ctx.permissions, roles: ctx.roles }} />
          </Suspense>
          <Card>
            <CardHeader title="Fulfilment" description="Who carries out this application's access changes that are done by hand." />
            <CardBody>
              <FulfilmentAssignments
                applicationId={id}
                assignments={assignments}
                types={entitlementTypes.map((t) => t.name)}
                choices={[
                  ...groups
                    .filter((g) => g.status === "active")
                    .map((g) => ({
                      value: `group:${g.id}`,
                      label: `${g.name} (group)`,
                    })),
                  ...people.map((p) => ({
                    value: `identity:${p.id}`,
                    label: p.displayName,
                  })),
                ]}
                canManage={canManage}
              />
            </CardBody>
          </Card>
        </TabPanel>
        <TabPanel value="accounts" className="pt-4">
          <Card>
            <CardHeader
              title="Accounts"
              description={
                lastRun
                  ? `Last reconciled ${new Date(lastRun.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${lastRun.status === "failed" ? ": failed" : ""}.`
                  : "Not reconciled yet."
              }
              actions={
                <LinkButton href={`/access/accounts?app=${id}`} size="sm" variant="outline">
                  View accounts
                </LinkButton>
              }
            />
            <CardBody className="space-y-3">
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Accounts</dt>
                  <dd className="tabular-nums text-foreground">{accountSummary.total}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Orphan</dt>
                  <dd className={accountSummary.orphan ? "tabular-nums text-destructive" : "tabular-nums text-foreground"}>{accountSummary.orphan}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Dormant</dt>
                  <dd className={accountSummary.dormant ? "tabular-nums text-warning" : "tabular-nums text-foreground"}>{accountSummary.dormant}</dd>
                </div>
              </dl>
              {lastRun?.status === "failed" && lastRun.error ? <p className="text-xs text-destructive">{lastRun.error}</p> : null}
              {canManage ? <ReconcileAccountsForm applicationId={id} disabledReason={onboarding?.promotedAt ? null : "Promote an onboarding configuration first"} /> : null}
              {canManage && onboarding?.promotedAt && onboarding.config.entitlementSource === "connector" ? <ReconcileAccessForm applicationId={id} disabledReason={null} /> : null}
              {lastAccessRun ? (
                <p className={lastAccessRun.status === "failed" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                  Access last reconciled {when(lastAccessRun.startedAt)}
                  {lastAccessRun.status === "failed" ? `: failed. ${lastAccessRun.error ?? ""}` : "."}
                </p>
              ) : null}
            </CardBody>
          </Card>
        </TabPanel>
        {canManage ? (
          <TabPanel value="settings" className="space-y-4 pt-4">
            <Card>
              <CardHeader title="Edit catalog details" description="Onboarding status changes through onboarding, not here." />
              <CardBody>
                <ApplicationForm application={app} people={people} />
              </CardBody>
            </Card>
            {lifecycleActions.length ? (
              <Card>
                <CardHeader title="Lifecycle" description="Suspending or retiring an application needs a reason and is audited." />
                <CardBody>
                  <LifecycleForm applicationId={id} actions={lifecycleActions} />
                </CardBody>
              </Card>
            ) : null}
          </TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
