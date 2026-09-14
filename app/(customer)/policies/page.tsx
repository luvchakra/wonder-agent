import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listPolicies } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { createPolicyAction } from "@/app/actions/access";
import { PoliciesTable } from "./PoliciesTable";
import { Card, CardHeader, CardBody, Button, TextField, SelectField } from "@/modules/ui";

const CATEGORIES = ["identity", "access", "runtime", "agent", "lifecycle"] as const;
const ACTIONS = ["flag", "restrict", "block"] as const;

export default async function PoliciesPage() {
  let ctx;
  try {
    ctx = await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const policies = await listPolicies(ctx.tenantId!);

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
            <Button type="submit" variant="secondary">
              Create
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
