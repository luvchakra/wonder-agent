import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getAuthorizationPolicy } from "@/lib/rbac/authorizationPolicies";
import { describeScope } from "@/lib/rbac/authorizeCore";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { Badge, Card, CardBody, CardHeader } from "@/modules/ui";
import { PolicyForm, PolicyStatusActions } from "../PolicyForm";
import { loadPolicyFormData } from "../data";

// FOUNDATION-P0-19 — one authorization policy: what it does, and (with
// tenant.security.manage) edit, activate or deactivate, delete.

export const metadata = { title: "Authorization policy" };

export default async function AuthorizationPolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  let ctx;
  try {
    ctx = await requireAnyPermission(["permissions.view", "tenant.security.manage"]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const canManage = ctx.permissions.includes("tenant.security.manage");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [policy, form, roles] = await Promise.all([
    getAuthorizationPolicy(ctx.tenantId!, id),
    canManage ? loadPolicyFormData(ctx.tenantId!) : Promise.resolve(null),
    listAssignableRoles(ctx.tenantId!),
  ]);
  if (!policy) notFound();
  const exempt = policy.exemptRoleIds.map((r) => roles.find((x) => x.id === r)?.displayName ?? "A role no longer available");

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/settings/authorization-policies" className="hover:text-foreground">
          Authorization policies
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{policy.name}</span>
      </nav>
      {sp.created ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {policy.name} was created. It applies from the next request.
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{policy.name}</h1>
            <Badge tone={policy.effect === "DENY" ? "danger" : "warning"}>{policy.effect === "DENY" ? "Deny" : "Require approval"}</Badge>
            <Badge tone={policy.status === "active" ? "success" : "neutral"}>{policy.status === "active" ? "Active" : "Inactive"}</Badge>
          </div>
          {policy.description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{policy.description}</p> : null}
        </div>
        {canManage ? <PolicyStatusActions id={policy.id} status={policy.status} /> : null}
      </div>
      <Card>
        <CardHeader title="What it does" />
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Permissions</dt>
            <dd className="font-mono text-xs text-foreground">{policy.permissions.join(", ")}</dd>
            <dt className="text-muted-foreground">Applies to</dt>
            <dd className="text-foreground">
              {describeScope(
                policy.scopeType,
                policy.scopeValues.map((v) => (form ? ([...form.applications, ...form.agents].find((o) => o.id === v)?.label ?? v) : v)),
              )}
            </dd>
            <dt className="text-muted-foreground">Exempt roles</dt>
            <dd className="text-foreground">{exempt.length ? exempt.join(", ") : "None"}</dd>
            <dt className="text-muted-foreground">Effect</dt>
            <dd className="text-foreground">
              {policy.effect === "DENY"
                ? "Refused, whatever roles allow it."
                : "Refused as a direct action and reported as needing approval; the approval workflow for these actions arrives with P1."}
            </dd>
          </dl>
        </CardBody>
      </Card>
      {form ? (
        <Card>
          <CardHeader title="Edit policy" />
          <CardBody>
            <PolicyForm values={policy} catalog={form.catalog} roles={form.roles} applications={form.applications} agents={form.agents} submitLabel="Save policy" />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
