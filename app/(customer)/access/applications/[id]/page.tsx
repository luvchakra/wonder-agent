import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getApplicationDetail, getOnboarding, listEntitlementsForApplication } from "@/modules/access-governance/service";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { getIntegration } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard, LinkButton } from "@/modules/ui";
import { ApplicationForm } from "../ApplicationForm";
import { APP_TYPE_LABEL, LEVEL_TONE, ONBOARDING_LABEL, ONBOARDING_STAGE_LABEL } from "../labels";
import { LifecycleForm } from "./onboarding/OnboardingForms";

// ACCESS-P0-15 — one application: catalog details, owners, classification,
// connector, and the access it holds. ACCESS-P0-16 adds its onboarding and
// the suspend / resume / retire lifecycle.

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { id } = await params;
  const tenantId = ctx.tenantId!;
  const app = await getApplicationDetail(tenantId, id);
  if (!app) notFound();
  const canManage = ctx.permissions.includes("access.manage");
  const [entitlements, people, integration, onboarding] = await Promise.all([
    listEntitlementsForApplication(tenantId, id),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
    app.sourceIntegrationId && ctx.permissions.includes("integration.read") ? getIntegration(tenantId, app.sourceIntegrationId) : Promise.resolve(null),
    getOnboarding(tenantId, id),
  ]);
  const lifecycleActions = (
    app.onboardingStatus === "ACTIVE" ? ["suspend", "retire"] : app.onboardingStatus === "SUSPENDED" ? ["resume", "retire"] : app.onboardingStatus === "RETIRED" ? [] : ["retire"]
  ) as ("suspend" | "resume" | "retire")[];
  const status = ONBOARDING_LABEL[app.onboardingStatus];

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
        <KpiCard size="sm" icon="TriangleAlert" tone={app.riskLevel === "critical" || app.riskLevel === "high" ? "danger" : "neutral"} label="Risk" value={app.riskLevel ? cap(app.riskLevel) : "Not assessed"} />
        <KpiCard size="sm" icon="ShieldCheck" tone="neutral" label="Data" value={app.dataClassification ? cap(app.dataClassification) : "Not classified"} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Details" />
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
              <Detail label="Registered">{new Date(app.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Detail>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Entitlements" description={entitlements.length > 20 ? `The first 20 of ${entitlements.length}.` : undefined} />
          <CardBody>
            {entitlements.length === 0 ? (
              <EmptyState title="No entitlements" description="They arrive from the connector, or are added by hand under access governance." />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {entitlements.slice(0, 20).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate text-foreground">{e.name}</span>
                    <span className="flex shrink-0 gap-1">
                      {e.privilegeLevel !== "standard" ? <Badge tone={e.privilegeLevel === "admin" ? "danger" : "warning"}>{e.privilegeLevel}</Badge> : null}
                      {e.dataClassification ? <Badge tone="neutral">{e.dataClassification}</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Onboarding"
            description={
              onboarding
                ? `Configuration v${onboarding.configVersion}. ${ONBOARDING_STAGE_LABEL[onboarding.status].label}.`
                : "Configure, validate, simulate and approve how this application is governed."
            }
            actions={
              app.onboardingStatus !== "RETIRED" || onboarding ? (
                <LinkButton href={`/access/applications/${id}/onboarding`} size="sm" variant={onboarding ? "outline" : "default"}>
                  {onboarding ? "Open onboarding" : canManage ? "Start onboarding" : "View onboarding"}
                </LinkButton>
              ) : null
            }
          />
          <CardBody>
            {onboarding ? (
              <Badge tone={ONBOARDING_STAGE_LABEL[onboarding.status].tone}>{ONBOARDING_STAGE_LABEL[onboarding.status].label}</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Not started.</p>
            )}
          </CardBody>
        </Card>
        {canManage && lifecycleActions.length ? (
          <Card>
            <CardHeader title="Lifecycle" description="Suspending or retiring an application needs a reason and is audited." />
            <CardBody>
              <LifecycleForm applicationId={id} actions={lifecycleActions} />
            </CardBody>
          </Card>
        ) : null}
      </div>

      {canManage ? (
        <Card>
          <CardHeader title="Edit catalog details" description="Onboarding status changes through onboarding, not here." />
          <CardBody>
            <ApplicationForm application={app} people={people} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
