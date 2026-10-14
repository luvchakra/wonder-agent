import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAttributeDefinitions, listIdentityRules, SETTABLE_FIELDS } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { RuleForm } from "./RuleForms";
import { ruleStatus, TRIGGER_LABEL } from "./labels";

export const metadata = { title: "Identity rules" };

// IDENTITY-P0-21 — attribute rules: set an identity's attribute from its other
// attributes when it is created, imported or changes. Published by a second
// administrator; a new rule only reports until it is switched to enforce.

export default async function IdentityRulesPage() {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("identity.manage");
  const [rules, definitions] = await Promise.all([listIdentityRules(tenantId), canManage ? listAttributeDefinitions(tenantId) : Promise.resolve([])]);
  const settable = [...Object.keys(SETTABLE_FIELDS), ...definitions.filter((d) => d.active).map((d) => d.name)];

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Identity rules</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Set an identity&apos;s attributes from its other attributes. A rule never overrides a value a connected source set.</p>
      </div>

      <Card>
        <CardHeader title="Rules" description={`${rules.filter((r) => r.status === "published").length} published`} />
        <CardBody>
          {rules.length === 0 ? (
            <EmptyState title="No rules yet" description={canManage ? "Create the first one below." : "An identity administrator can add them."} />
          ) : (
            <TableContainer label="Identity rules" bare>
              <Thead>
                <tr>
                  <Th>Rule</Th>
                  <Th hideBelow="lg">When</Th>
                  <Th>Status</Th>
                </tr>
              </Thead>
              <tbody>
                {rules.map((r) => {
                  const status = ruleStatus(r);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/identities/rules/${r.id}`} className="font-medium text-primary hover:underline">
                          {r.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          Sets {r.effects.map((e) => String(e.params.attribute)).join(", ")} · {r.mode === "enforce" ? "Enforce" : "Report only"}
                        </span>
                      </Td>
                      <Td hideBelow="lg">{TRIGGER_LABEL[r.triggerType] ?? r.triggerType}</Td>
                      <Td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">New rule</summary>
          <div className="mt-4">
            <RuleForm settable={settable} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
