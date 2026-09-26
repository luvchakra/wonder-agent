import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAuthorizationPolicies } from "@/lib/rbac/authorizationPolicies";
import { describeScope } from "@/lib/rbac/authorizeCore";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { PolicyForm } from "./PolicyForm";
import { loadPolicyFormData } from "./data";

// FOUNDATION-P0-19 — Authorization policies (spec §21): the organization's
// explicit deny and require-approval rules. They take away; they never
// grant. Seen with permissions.view; written with tenant.security.manage.

export const metadata = { title: "Authorization policies" };

export default async function AuthorizationPoliciesPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  let ctx;
  try {
    ctx = await requireAnyPermission(["permissions.view", "tenant.security.manage"]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const canManage = ctx.permissions.includes("tenant.security.manage");
  const [policies, sp, form] = await Promise.all([listAuthorizationPolicies(ctx.tenantId!), searchParams, canManage ? loadPolicyFormData(ctx.tenantId!) : Promise.resolve(null)]);
  const scopeLabel = (type: string, values: string[]) => {
    if (!form || type === "environment" || type === "tenant") return describeScope(type as never, values);
    const options = type === "application" ? form.applications : form.agents;
    return describeScope(type as never, values.map((v) => options.find((o) => o.id === v)?.label ?? v));
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Authorization policies</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Explicit rules that override what roles allow: deny an action, or hold it for approval, across the organization or in a scope. A policy never grants anything.
        </p>
      </div>
      {sp.deleted ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          The policy was deleted.
        </p>
      ) : null}
      <Card>
        <CardHeader title={`${policies.length} ${policies.length === 1 ? "policy" : "policies"}`} />
        <CardBody>
          {policies.length === 0 ? (
            <EmptyState title="No policies" description="Without policies, roles alone decide what people can do." />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Policy</Th>
                  <Th>Effect</Th>
                  <Th hideBelow="lg">Permissions</Th>
                  <Th hideBelow="xl">Applies to</Th>
                  <Th>Status</Th>
                </tr>
              </Thead>
              <tbody>
                {policies.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Link href={`/settings/authorization-policies/${p.id}`} className="font-medium text-foreground hover:text-primary">
                        {p.name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={p.effect === "DENY" ? "danger" : "warning"}>{p.effect === "DENY" ? "Deny" : "Require approval"}</Badge>
                    </Td>
                    <Td hideBelow="lg">
                      <span className="font-mono text-xs text-muted-foreground">{p.permissions.join(", ")}</span>
                    </Td>
                    <Td hideBelow="xl" className="text-muted-foreground">
                      {scopeLabel(p.scopeType, p.scopeValues)}
                    </Td>
                    <Td>
                      <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Inactive"}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
      {form ? (
        <Card>
          <CardHeader title="New policy" description="Applies from the next request of everyone it covers." />
          <CardBody>
            <PolicyForm
              values={{ name: "", description: null, effect: "DENY", permissions: [], scopeType: "tenant", scopeValues: [], exemptRoleIds: [] }}
              catalog={form.catalog}
              roles={form.roles}
              applications={form.applications}
              agents={form.agents}
              submitLabel="Create policy"
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
