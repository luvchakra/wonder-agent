import Link from "next/link";
import { notFound } from "next/navigation";
import { platformTenantRef } from "@/lib/refs/objectRef";
import { isPlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import {
  ADDABLE_ENVIRONMENTS,
  INDUSTRIES,
  USER_BASE_SIZES,
  getEnvironmentStats,
  getOrganizationProfile,
  getSubscription,
  getTenant,
  listFlagCatalog,
  listTenantFlagOverrides,
  listTenants,
  organizationOwners,
} from "@/modules/platform-admin/service";
import { BILLING_COUNTRIES } from "@/modules/billing/countries";
import { groupOrganizations } from "@/modules/platform-admin/organizations";
import { activateTenantAction, createTenantEnvironmentAction, removeOrganizationAction, removeTenantEnvironmentAction, setFeatureFlagAction, suspendTenantAction } from "@/app/actions/platform";
import { baseAppHost, tenantUrl } from "@/lib/tenant/host";
import type { PlatformTenant } from "@/lib/shared/types/platform";
import { Badge, Button, Card, CardBody, CardHeader, EnvironmentBadge, ENVIRONMENT_COLOR, StatCard, StatusBadge, TableContainer, Td, Th, Thead, Tr, fieldInputClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { PageHeading } from "@/app/platform-admin/PageHeading";
import { AddressForm, EnvironmentForm, NotesForm, OrganizationNameForm, OrganizationProfileForm, PlanForm } from "./TenantSettingsForms";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const STATUS = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  deprovisioned: { tone: "neutral", label: "Decommissioned" },
} as const;

const envLabel = (e: string) => ENVIRONMENT_COLOR[e as keyof typeof ENVIRONMENT_COLOR]?.label ?? e;
const fmt = (n: number | null) => (n === null ? "Unavailable" : n.toLocaleString("en-US"));

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function RemoveMenu({ label, text, action }: { label: string; text: string; action: () => Promise<void> }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-destructive hover:bg-accent">Remove…</summary>
      <form action={action} className="absolute right-0 z-10 mt-1 w-72 space-y-2 rounded-md border border-border bg-popover p-3 text-left shadow-lg">
        <p className="text-xs text-muted-foreground">{text}</p>
        <Button type="submit" size="sm" variant="destructive">
          {label}
        </Button>
      </form>
    </details>
  );
}

/**
 * Owner request (2026-10-13): one environment's page. Says plainly that it
 * is an environment, shows what is in it and how busy it is (counts only,
 * scoped to this tenant), then what can be configured for it: address,
 * environment type, features, notes and status. The plan is the
 * organization's, the same in every environment (owner decision).
 */
async function EnvironmentPage({ tenant, organization, base }: { tenant: PlatformTenant; organization: { id: string; ref: number | null; name: string; envCount: number }; base: string | null }) {
  const [stats, orgSub, flags, overrides] = await Promise.all([getEnvironmentStats(tenant.tenantId), getSubscription(organization.id), listFlagCatalog(), listTenantFlagOverrides(tenant.tenantId)]);
  const url = tenant.slug && tenant.status !== "deprovisioned" ? tenantUrl(tenant.slug, base) : null;
  const isOrganization = tenant.tenantId === organization.id;
  const status = STATUS[tenant.status ?? "active"];
  const lastActivity = stats.lastActivityAt ? new Date(stats.lastActivityAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST" : "None recorded";
  return (
    <>
      <Link href={`/platform-admin/tenants/${organization.ref ?? organization.id}`} className="text-sm font-medium text-primary hover:underline">
        ← {organization.name}
      </Link>
      <div className="space-y-1">
        <Eyebrow>Environment</Eyebrow>
        <PageHeading title={`${organization.name} · ${envLabel(tenant.environment)}`} description={url ? url.replace(/^https?:\/\//, "") : (tenant.slug ?? undefined)}>
          <div className="flex items-center gap-2">
            <EnvironmentBadge environment={tenant.environment} />
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
        </PageHeading>
      </div>

      <section aria-label="In this environment" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Users" value={fmt(stats.users)} />
        <StatCard label="Identities" value={fmt(stats.identities)} />
        <StatCard label="Applications" value={fmt(stats.applications)} />
        <StatCard label="Accounts" value={fmt(stats.accounts)} />
        <StatCard label="AI agents" value={fmt(stats.agents)} />
        <StatCard label="Connections" value={fmt(stats.connections)} />
        <StatCard label="Access requests" value={fmt(stats.accessRequests)} />
        <StatCard label="Risk findings" value={fmt(stats.findings)} />
      </section>
      <Card>
        <CardHeader title="Load" description="Runtime activity reaching this environment." />
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <dl className="flex flex-wrap gap-x-10 gap-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Runtime events, last 30 days</dt>
              <dd className="text-lg font-semibold text-foreground">{fmt(stats.runtimeEvents30d)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last activity</dt>
              <dd className="text-lg font-semibold text-foreground">{lastActivity}</dd>
            </div>
          </dl>
          <Link href={`/platform-admin/tenants/${tenant.ref ?? tenant.tenantId}/usage`} className="text-sm font-medium text-primary hover:underline">
            Usage against plan limits →
          </Link>
        </CardBody>
      </Card>

      <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Configuration</h2>
      <Card>
        <CardHeader title="Address" description={url ?? undefined} />
        <CardBody>
          <AddressForm tenantId={tenant.tenantId} slug={tenant.slug ?? ""} base={base} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Environment type" />
        <CardBody>
          <EnvironmentForm tenantId={tenant.tenantId} environment={tenant.environment} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Plan" description="The organization's plan applies to every environment." />
        <CardBody className="flex flex-wrap items-center gap-3 text-sm">
          {orgSub ? (
            <Badge tone="info" className="capitalize">
              {orgSub.plan}
            </Badge>
          ) : (
            <span className="text-muted-foreground">No plan yet</span>
          )}
          <Link href={`/platform-admin/tenants/${organization.ref ?? organization.id}#plan`} className="font-medium text-primary hover:underline">
            Change on the organization
          </Link>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Features" description="On or off for this environment; unset follows the platform default." />
        {flags.length ? (
          <ul className="divide-y divide-border">
            {flags.map((f) => {
              const override = overrides[f.key];
              const on = override ?? f.defaultEnabled;
              return (
                <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{f.displayName}</span>
                    <span className="block text-xs text-muted-foreground">{override === undefined ? `Platform default (${f.defaultEnabled ? "on" : "off"})` : "Set for this environment"}</span>
                  </span>
                  <form action={setFeatureFlagAction.bind(null, tenant.tenantId)}>
                    <input type="hidden" name="flagKey" value={f.key} />
                    <input type="hidden" name="enabled" value={on ? "false" : "true"} />
                    <Button type="submit" size="sm" variant={on ? "outline" : "default"} aria-label={`${on ? "Turn off" : "Turn on"} ${f.displayName}`}>
                      {on ? "On · turn off" : "Off · turn on"}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No features in the catalogue.</p>
        )}
      </Card>
      <Card>
        <CardHeader title="Notes" description="For platform administrators only; the customer never sees them." />
        <CardBody>
          <NotesForm tenantId={tenant.tenantId} notes={tenant.notes} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Status" description={tenant.status === "deprovisioned" ? "Removed." : tenant.status === "suspended" ? "Suspended: nobody can sign in." : "Active."} />
        {tenant.status !== "deprovisioned" ? (
          <CardBody className="flex flex-wrap items-center gap-2">
            {tenant.status === "suspended" ? (
              <form action={activateTenantAction.bind(null, tenant.tenantId)}>
                <Button type="submit" size="sm" variant="outline">
                  Activate
                </Button>
              </form>
            ) : (
              <form action={suspendTenantAction.bind(null, tenant.tenantId)}>
                <Button type="submit" size="sm" variant="outline">
                  Suspend
                </Button>
              </form>
            )}
            {isOrganization ? (
              <RemoveMenu
                label="Remove organization"
                text={`This is the organization's own environment. Removing it decommissions the whole organization and its ${organization.envCount} environment${organization.envCount === 1 ? "" : "s"}; their data is kept and nobody can sign in.`}
                action={removeOrganizationAction.bind(null, organization.id)}
              />
            ) : (
              <RemoveMenu
                label={`Remove ${envLabel(tenant.environment)}`}
                text="Decommissions this environment (its data is kept, nobody can sign in) and frees its address."
                action={removeTenantEnvironmentAction.bind(null, tenant.tenantId, organization.id)}
              />
            )}
          </CardBody>
        ) : null}
      </Card>
    </>
  );
}

/**
 * Owner request (2026-10-13): the organization's page shows the
 * organization only: its owners, its environments (each with Manage and
 * Remove), its plan (one for every environment) and its details. Each
 * environment's settings are on that environment's page.
 */
export default async function PlatformTenantPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<{ view?: string }> }) {
  const [{ tenantId: raw }, { view }] = await Promise.all([params, searchParams]);
  // Vendor-only (the console layout checks too; a page renders alongside its layout, so check here before any lookup).
  if (!(await isPlatformAdmin())) notFound();
  // FOUNDATION-P0-34: the URL carries the organization's global number; an old UUID link redirects.
  const tenantId = await platformTenantRef(raw, (ref) => `/platform-admin/tenants/${ref}${view ? `?view=${encodeURIComponent(view)}` : ""}`);
  const [tenant, all] = await Promise.all([getTenant(tenantId), listTenants({ includeDecommissioned: true })]);
  if (!tenant) notFound();
  const base = baseAppHost();
  // Removed environments are not part of an organization's current set.
  const orgs = groupOrganizations(all.filter((t) => t.status !== "deprovisioned" || t.tenantId === tenantId));
  const org = orgs.find((o) => o.environments.some((e) => e.tenantId === tenantId))!;
  const organization = { id: org.id, ref: org.ref, name: org.name, envCount: org.environments.length };

  if (org.primary.tenantId !== tenantId || view === "environment") return <EnvironmentPage tenant={tenant} organization={organization} base={base} />;

  const [owners, subscription, profile] = await Promise.all([organizationOwners([tenantId]), getSubscription(tenantId), getOrganizationProfile(tenantId)]);
  const ownerList = owners.get(tenantId) ?? [];
  const missing = tenant.status === "active" ? ADDABLE_ENVIRONMENTS.filter((k) => !org.environments.some((e) => e.environment === k && e.status !== "deprovisioned")) : [];

  return (
    <>
      <Link href="/platform-admin/tenants" className="text-sm font-medium text-primary hover:underline">
        ← Organizations
      </Link>
      <div className="space-y-1">
        <Eyebrow>Organization</Eyebrow>
        <PageHeading title={org.name} description={profile?.description ?? `${org.environments.length} environment${org.environments.length === 1 ? "" : "s"}`} />
      </div>

      <Card>
        <CardHeader title="Environments" description="Each is separate, with its own data, users and address." />
        <TableContainer label="Environments" bare>
          <Thead>
            <tr>
              <Th>Environment</Th>
              <Th>Address</Th>
              <Th>Status</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </Thead>
          <tbody>
            {org.environments.map((e) => {
              const url = e.slug && e.status !== "deprovisioned" ? tenantUrl(e.slug, base) : null;
              const status = STATUS[e.status ?? "active"];
              const isRoot = e.tenantId === tenantId;
              return (
                <Tr key={e.tenantId}>
                  <Td>
                    <EnvironmentBadge environment={e.environment} />
                  </Td>
                  <Td className="font-mono text-xs text-muted-foreground">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                        {url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      e.slug
                    )}
                  </Td>
                  <Td>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={isRoot ? `/platform-admin/tenants/${e.ref ?? e.tenantId}?view=environment` : `/platform-admin/tenants/${e.ref ?? e.tenantId}`}
                        className="whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent"
                      >
                        Manage
                      </Link>
                      {e.status !== "deprovisioned" ? (
                        isRoot ? (
                          <RemoveMenu
                            label="Remove organization"
                            text={`This is the organization's own environment. Removing it decommissions the whole organization and its ${org.environments.length} environment${org.environments.length === 1 ? "" : "s"}; their data is kept and nobody can sign in.`}
                            action={removeOrganizationAction.bind(null, tenantId)}
                          />
                        ) : (
                          <RemoveMenu
                            label={`Remove ${envLabel(e.environment)}`}
                            text="Decommissions this environment (its data is kept, nobody can sign in) and frees its address."
                            action={removeTenantEnvironmentAction.bind(null, e.tenantId, tenantId)}
                          />
                        )
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableContainer>
        {missing.length ? (
          <CardBody className="border-t border-border">
            <form action={createTenantEnvironmentAction.bind(null, tenantId)} className="flex flex-wrap items-center gap-2">
              <select name="environment" aria-label="Environment to add" className={cn(fieldInputClass, "w-44")}>
                {missing.map((k) => (
                  <option key={k} value={k}>
                    {ENVIRONMENT_COLOR[k].label}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline">
                Add environment
              </Button>
            </form>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Owners" description="The organization's administrators." />
        {ownerList.length ? (
          <ul className="divide-y divide-border">
            {ownerList.map((o) => (
              <li key={o.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="text-sm font-medium text-foreground">{o.name || o.email}</span>
                <a href={`mailto:${o.email}`} className="text-sm text-primary hover:underline">
                  {o.email}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No active administrator.</p>
        )}
      </Card>

      <Card>
        <div id="plan" className="scroll-mt-6" />
        <CardHeader
          title="Plan"
          description={
            subscription
              ? `${subscription.plan} in every environment · ${subscription.provider === "manual" || !subscription.provider ? "assigned by the platform" : `billed through ${subscription.provider}`}`
              : "No plan yet"
          }
        />
        <CardBody>
          <PlanForm tenantId={tenantId} plan={subscription?.plan ?? null} organization />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Organization details" description="Name, description, contacts and company details. Seen only in the platform console." />
        <CardBody className="space-y-6">
          <OrganizationNameForm tenantId={tenantId} name={org.name} />
          <OrganizationProfileForm tenantId={tenantId} profile={profile} industries={INDUSTRIES} sizes={USER_BASE_SIZES} countries={BILLING_COUNTRIES} />
        </CardBody>
      </Card>
    </>
  );
}
