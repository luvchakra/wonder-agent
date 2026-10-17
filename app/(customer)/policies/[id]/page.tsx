import { notFound, redirect } from "next/navigation";
import { pageRef } from "@/lib/refs/objectRef";
import { getRecordProvenance } from "@/lib/provenance/recordProvenance";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getPolicy, listPolicyExceptions, listPolicyHistory, listPolicyRules } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { addPolicyRuleAction, addPolicyExceptionAction, revokeExceptionAction } from "@/app/actions/access";
import { targetsFromScope } from "@/modules/access-governance/policyTargets";
import { PublishPolicyButton } from "./PublishPolicyButton";
import { RecordProvenance, Badge, StatusBadge, SeverityBadge, Card, CardHeader, CardBody, Button, EmptyState, TextField, SelectField } from "@/modules/ui";

const RULE_TYPES = ["rbac", "abac", "resource", "time"] as const;
const RESIDUAL_RISKS = ["low", "medium", "high", "critical"] as const;

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  // FOUNDATION-P0-34: the URL carries the policy's number; an old UUID link redirects.
  const id = await pageRef(ctx.tenantId!, "policies", rawId, (n) => `/policies/${n}`);
  const policy = await getPolicy(id, ctx.tenantId!);
  if (!policy) notFound();

  const [rules, exceptions, provenance, history] = await Promise.all([
    listPolicyRules(id, ctx.tenantId!),
    listPolicyExceptions(id, ctx.tenantId!),
    getRecordProvenance(ctx.tenantId!, "policies", id),
    // ACCESS-P0-35: every change is a version; changes apply at once (owner decision 2026-10-17).
    listPolicyHistory(id, ctx.tenantId!).catch(() => null),
  ]);
  const targets = targetsFromScope(policy.scope);
  const canPublish = ctx.permissions.includes("policy.publish");
  const addRuleWithId = addPolicyRuleAction.bind(null, id);
  const addExceptionWithId = addPolicyExceptionAction.bind(null, id);

  return (
    <div className="space-y-4">
      <Link href="/policies" className="text-sm text-primary hover:underline">
        ← All policies
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{policy.name}</h1>
          <Badge tone={policy.status === "active" ? "success" : policy.status === "draft" ? "warning" : "neutral"}>
            {policy.status === "active" ? "In effect" : policy.status}
          </Badge>
          <span className="text-xs text-muted-foreground">v{policy.version}</span>
          {/* ACCESS-P0-12: a draft or disabled policy takes effect only when published. */}
          {policy.status !== "active" && canPublish ? <PublishPolicyButton policyId={policy.id} /> : null}
        </div>
        <RecordProvenance record={provenance} className="mt-1" />
        <p className="mt-1 text-sm text-muted-foreground">
          Category: {policy.policyCategory} · Severity: <SeverityBadge severity={policy.severity} /> · Action: {policy.action} · Priority:{" "}
          {policy.priority ?? 0}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Applies to:{" "}
          {targets.length === 0
            ? "every request in its category"
            : targets.map((t) => `${t.type.replace(/_/g, " ").toLowerCase()} “${t.value}”`).join(", ")}
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
        <CardHeader
          title="Exceptions"
          description={`${exceptions.length} exception${exceptions.length === 1 ? "" : "s"} — the canonical governance exception model (ACCESS-P0-07)`}
        />
        <CardBody className="space-y-3">
          {exceptions.length === 0 ? (
            <EmptyState title="No exceptions granted" />
          ) : (
            <ul className="space-y-2">
              {exceptions.map((e) => {
                const revokeWithIds = revokeExceptionAction.bind(null, id, e.id);
                const isExpired = !!e.expiresAt && new Date(e.expiresAt) < new Date();
                return (
                  <li key={e.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={e.status === "revoked" ? "neutral" : isExpired ? "warning" : "success"}>
                        {e.status === "revoked" ? "revoked" : isExpired ? "expired" : "active"}
                      </StatusBadge>
                      {e.residualRisk && <SeverityBadge severity={e.residualRisk} />}
                      <span className="text-muted-foreground">{e.agentId ? `agent ${e.agentId}` : "tenant-wide"}</span>
                      {e.expiresAt && <span className="text-xs text-muted-foreground">expires {e.expiresAt}</span>}
                    </div>
                    <p className="mt-1 text-foreground">{e.reason}</p>
                    {e.businessJustification && <p className="mt-1 text-xs text-muted-foreground">Justification: {e.businessJustification}</p>}
                    {e.compensatingControl && <p className="text-xs text-muted-foreground">Compensating control: {e.compensatingControl}</p>}
                    {e.status !== "revoked" && (
                      <form action={revokeWithIds} className="mt-2">
                        <Button type="submit" variant="destructive" size="sm">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <form action={addExceptionWithId} className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField label="Reason" name="reason" required />
            </div>
            <TextField label="Agent ID (blank = tenant-wide)" name="agentId" placeholder="agent id (uuid)" />
            <TextField label="Expires at" name="expiresAt" type="datetime-local" />
            <TextField label="Business justification" name="businessJustification" />
            <TextField label="Compensating control" name="compensatingControl" />
            <SelectField label="Residual risk" name="residualRisk" defaultValue="">
              <option value="">—</option>
              {RESIDUAL_RISKS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectField>
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary">
                Add exception
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <details className="rounded-lg border border-border bg-card" data-testid="policy-history">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-foreground">
          Change history <span className="text-muted-foreground">({history === null ? "unavailable" : `${history.length} ${history.length === 1 ? "change" : "changes"}`})</span>
        </summary>
        <div className="border-t border-border px-4 py-3">
          {history === null ? (
            <p role="status" className="text-sm text-muted-foreground">The history could not be loaded just now.</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes since it was created.</p>
          ) : (
            <ol className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.version} className="py-2.5 text-sm">
                  <p className="font-medium text-foreground">Version {h.version}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.changedByName ?? "Unknown"} · {h.changedAt.slice(0, 16).replace("T", " ")} UTC
                  </p>
                  {h.changes.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {h.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </div>
  );
}
