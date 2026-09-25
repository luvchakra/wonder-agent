import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listPolicies } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { POLICY_TARGET_TYPES, type PolicyTargetType } from "@/lib/shared/types/access-governance";
import { createPolicyAction } from "@/app/actions/access";
import { PoliciesTable } from "./PoliciesTable";
import { Card, CardHeader, CardBody, Button, TextField, SelectField } from "@/modules/ui";

const CATEGORIES = ["identity", "access", "runtime", "agent", "lifecycle"] as const;
const ACTIONS = ["flag", "restrict", "block"] as const;
const TARGET_LABEL: Record<PolicyTargetType, string> = {
  TOOL: "A tool",
  MCP_SERVER: "An MCP server",
  MCP_TOOL: "An MCP tool (server:tool)",
  DATA_SOURCE: "A data source",
  DATA_RESOURCE: "A data resource (* prefix)",
  ACTION: "An action",
};

export default async function PoliciesPage() {
  let ctx;
  try {
    ctx = await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const policies = await listPolicies(ctx.tenantId!);
  const canPublish = ctx.permissions.includes("policy.publish");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Policies</h1>

      <Card>
        <CardHeader title="Policies" description={`${policies.length} defined`} />
        <CardBody>
          <PoliciesTable policies={policies} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Create a policy" />
        <CardBody>
          <form action={createPolicyAction} className="flex flex-wrap items-end gap-2">
            <TextField label="Policy name" name="name" required />
            <SelectField label="Category" name="policyCategory">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField label="Action" name="action">
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </SelectField>
            {/* ACCESS-P0-12: what it applies to, its priority, and whether it takes effect now. */}
            <SelectField label="Applies to" name="targetType" defaultValue="">
              <option value="">Every request</option>
              {POLICY_TARGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </SelectField>
            <TextField label="Target" name="targetValue" placeholder="e.g. delete_customer, finance-mcp:post_journal" />
            <TextField label="Priority" name="priority" type="number" defaultValue="0" min={-1000} max={1000} />
            <SelectField label="Status" name="status" defaultValue={canPublish ? "active" : "draft"}>
              <option value="draft">Save as draft</option>
              {canPublish ? <option value="active">Publish now</option> : null}
            </SelectField>
            <Button type="submit" variant="secondary">
              Create
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
