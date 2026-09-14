import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getPolicy, listPolicyExceptions, listPolicyRules } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { addPolicyRuleAction } from "@/app/actions/access";
import { Badge, SeverityBadge, Card, CardHeader, CardBody, Button, EmptyState, TextField, SelectField } from "@/modules/ui";

const RULE_TYPES = ["rbac", "abac", "resource", "time"] as const;

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const policy = await getPolicy(id);
  if (!policy) notFound();

  const [rules, exceptions] = await Promise.all([listPolicyRules(id), listPolicyExceptions(id)]);
  const addRuleWithId = addPolicyRuleAction.bind(null, id);

  return (
    <div className="space-y-4">
      <Link href="/policies" className="text-sm text-primary hover:underline">
        ← All policies
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{policy.name}</h1>
          <Badge tone={policy.status === "active" ? "success" : "neutral"}>{policy.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Category: {policy.policyCategory} · Severity: <SeverityBadge severity={policy.severity} /> · Action: {policy.action}
        </p>
      </div>

      <Card>
        <CardHeader title="Rules" description={`${rules.length} rule${rules.length === 1 ? "" : "s"}`} />
        <CardBody className="space-y-3">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules defined.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {rules.map((r) => (
                <li key={r.id}>
                  <Badge tone="neutral">{r.ruleType}</Badge> <code className="text-xs text-foreground">{JSON.stringify(r.condition)}</code>
                </li>
              ))}
            </ul>
          )}
          <form action={addRuleWithId} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <SelectField label="Rule type" name="ruleType">
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectField>
            <div className="flex-1 min-w-[16rem]">
              <TextField label="Condition (JSON)" name="condition" placeholder='{"field":"agent.criticality","op":"eq","value":"high"}' required />
            </div>
            <Button type="submit" variant="secondary">
              Add rule
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Exceptions" description={`${exceptions.length} exception${exceptions.length === 1 ? "" : "s"}`} />
        <CardBody>
          {exceptions.length === 0 ? (
            <EmptyState title="No exceptions granted" />
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {exceptions.map((e) => (
                <li key={e.id}>
                  {e.reason} <span className="text-muted-foreground">{e.agentId ? `(agent ${e.agentId})` : "(tenant-wide)"}</span>
                  {e.expiresAt ? ` — expires ${e.expiresAt}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
