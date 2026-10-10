import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getTenantConfig } from "@/lib/config/tenantConfig";
import { listAuthorizationPolicies } from "@/lib/rbac/authorizationPolicies";
import { listPolicies, listRequestPolicies, listSoDRules, SOD_CONFLICT_ACTION } from "@/modules/access-governance/service";
import { listAuditLogs } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard } from "@/modules/ui";

// Control Center › Overview (owner request, 2026-10-10): the organization's
// controls in one place — the policies in effect, the SoD rules and what
// they caught, request and authorization policies. Every number is a count
// of the tenant's own records, each card links to its list, and a card the
// viewer may not open is left out rather than shown empty.

const CATEGORY: Record<string, string> = { identity: "Identity", access: "Access", runtime: "Runtime", agent: "Agent", lifecycle: "Lifecycle" };
const CONFLICT_CAP = 200;
/** The start of the conflict window, read once per request on the server. */
const windowStart = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export default async function ControlCenterPage() {
  let ctx;
  try {
    ctx = await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const can = (...keys: string[]) => keys.some((k) => ctx.permissions.includes(k));
  // The organization's window (Global Configuration).
  const conflictWindowDays = (await getTenantConfig(tenantId))["sod.conflictWindowDays"];
  const since = windowStart(conflictWindowDays);
  const [policies, sodRules, conflicts, requestPolicies, authzPolicies] = await Promise.all([
    listPolicies(tenantId),
    listSoDRules(tenantId),
    can("audit.read") ? listAuditLogs(tenantId, { action: SOD_CONFLICT_ACTION, from: since }, null, CONFLICT_CAP) : Promise.resolve(null),
    can("access.manage") ? listRequestPolicies(tenantId) : Promise.resolve(null),
    can("permissions.view", "tenant.security.manage") ? listAuthorizationPolicies(tenantId) : Promise.resolve(null),
  ]);

  const inEffect = policies.filter((p) => p.status === "active");
  const notInEffect = policies.filter((p) => p.status !== "active");
  const sodInEffect = sodRules.filter((r) => r.policyStatus === "active");
  const blocked = conflicts ? conflicts.entries.filter((e) => e.outcome === "failure").length : 0;
  const byCategory = Object.entries(
    inEffect.reduce<Record<string, number>>((acc, p) => ((acc[p.policyCategory] = (acc[p.policyCategory] ?? 0) + 1), acc), {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Control Center</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">The controls that govern access in this organization, and what they caught.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard size="sm" icon="Scale" tone="primary" label="Policies in effect" value={inEffect.length} href="/policies" />
        <KpiCard size="sm" icon="Ban" tone={sodInEffect.length ? "success" : "neutral"} label="SoD rules in effect" value={sodInEffect.length} href="/sod" />
        {conflicts ? (
          <KpiCard
            size="sm"
            icon="ShieldAlert"
            tone={conflicts.entries.length ? "warning" : "neutral"}
            label={`SoD conflicts, ${conflictWindowDays} days`}
            value={conflicts.nextCursor ? `${CONFLICT_CAP}+` : conflicts.entries.length}
            footnote={conflicts.entries.length ? `${blocked} refused` : undefined}
            href="/sod/conflicts"
          />
        ) : null}
        {requestPolicies ? <KpiCard size="sm" icon="ClipboardList" tone="neutral" label="Request policies" value={requestPolicies.length} href="/access/request-policies" /> : null}
        {authzPolicies ? (
          <KpiCard
            size="sm"
            icon="KeyRound"
            tone="neutral"
            label="Authorization policies active"
            value={authzPolicies.filter((p) => p.status === "active").length}
            href="/settings/authorization-policies"
          />
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Policies in effect" description="By what they govern." />
          <CardBody>
            {byCategory.length === 0 ? (
              <EmptyState title="No policies in effect" description="Publish a policy to put it in effect." />
            ) : (
              <ul className="divide-y divide-border">
                {byCategory.map(([category, count]) => (
                  <li key={category} className="flex items-center justify-between py-2 text-sm">
                    <span>{CATEGORY[category] ?? category}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Not in effect" description="Drafts and disabled policies enforce nothing." />
          <CardBody>
            {notInEffect.length === 0 ? (
              <EmptyState title="Every policy is in effect" />
            ) : (
              <ul className="divide-y divide-border">
                {notInEffect.slice(0, 8).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/policies/${p.id}`} className="min-w-0 truncate text-primary hover:underline">
                      {p.name}
                    </Link>
                    <Badge tone={p.status === "draft" ? "warning" : "neutral"}>{p.status === "draft" ? "Draft" : "Disabled"}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {notInEffect.length > 8 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                and {notInEffect.length - 8} more in{" "}
                <Link href="/policies" className="text-primary hover:underline">
                  Policies
                </Link>
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
