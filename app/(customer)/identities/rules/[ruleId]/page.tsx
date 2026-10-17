import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageRef } from "@/lib/refs/objectRef";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentityRule, listAttributeDefinitions, listRuleGrantTargets, SETTABLE_FIELDS } from "@/modules/agent-identity/service";
import { listRuleRuns } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader } from "@/modules/ui";
import { RetireRuleButton, RuleForm, RuleNextStep, type RuleFormValues } from "../RuleForms";
import { ruleStatus, TRIGGER_LABEL } from "../labels";

export const metadata = { title: "Identity rule" };

const OUTCOME: Record<string, string> = {
  applied: "Applied",
  reported: "Would apply (report only)",
  not_matched: "Condition not met",
  out_of_scope: "Out of scope",
  skipped: "Left as it was",
  error: "Error",
};
const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const value = (v: unknown) =>
  v && typeof v === "object" ? ("template" in v ? String((v as { template: string }).template) : `{${(v as { ref: string }).ref}}`) : v === null || v === undefined || v === "" ? "(empty)" : String(v);

// IDENTITY-P0-21 — one attribute rule: what it does, its one next step
// (simulate, ask to publish, approve), its recent runs; editing and
// retiring are folded away.
export default async function IdentityRulePage({ params }: { params: Promise<{ ruleId: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  // FOUNDATION-P0-34: the URL carries the rule's number; an old UUID link redirects.
  const ruleId = await pageRef(tenantId, "lifecycle_rules", (await params).ruleId, (n) => `/identities/rules/${n}`);
  const canManage = ctx.permissions.includes("identity.manage");
  const [rule, runs, definitions, targets] = await Promise.all([
    getIdentityRule(tenantId, ruleId),
    listRuleRuns(tenantId, { ruleId, limit: 20 }),
    canManage ? listAttributeDefinitions(tenantId) : Promise.resolve([]),
    listRuleGrantTargets(tenantId),
  ]);
  if (!rule) notFound();
  const targetName = (id: string) => [...targets.groups, ...targets.packages].find((t) => t.id === id)?.name ?? "(no longer active)";

  const status = ruleStatus(rule);
  const simulatedSinceEdit = Boolean(rule.lastSimulatedAt);
  const step =
    rule.status === "retired" || !canManage
      ? "none"
      : rule.publishRequestedBy
        ? rule.publishRequestedBy === ctx.userId
          ? "waiting"
          : "approve"
        : !rule.unpublishedChanges
          ? "none"
          : simulatedSinceEdit
            ? "request"
            : "simulate";
  const effect = rule.effects[0];
  const settable = [...Object.keys(SETTABLE_FIELDS), ...definitions.filter((d) => d.active).map((d) => d.name)];
  const initial: RuleFormValues = {
    name: rule.name,
    triggerType: rule.triggerType,
    triggerAttribute: rule.triggerAttribute ?? "",
    condition: rule.condition === "true" ? "" : rule.condition,
    effectType: effect?.type === "open_task" || effect?.type === "add_to_group" || effect?.type === "assign_package" ? effect.type : "set_attribute",
    grantTarget: String(effect?.params.group ?? effect?.params.package ?? ""),
    approval: effect?.params.approval === "automatic" ? "automatic" : "required",
    taskTitle: effect?.type === "open_task" ? String(effect.params.title ?? "") : "",
    taskFor: effect?.params.assignee === "identity_admins" ? "identity_admins" : "manager",
    attribute: String(effect?.params.attribute ?? ""),
    valueKind: effect && typeof effect.params.value === "object" && effect.params.value && "template" in effect.params.value ? "template" : "fixed",
    value:
      effect && typeof effect.params.value === "object" && effect.params.value && "template" in effect.params.value
        ? String((effect.params.value as { template: string }).template)
        : effect?.params.value == null
          ? ""
          : String(effect.params.value),
    mode: rule.mode,
  };

  return (
    <div className="space-y-6">
      <Link href="/identities/rules" className="text-sm font-medium text-primary hover:underline">
        ← Identity rules
      </Link>
      <div className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{rule.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-xs text-muted-foreground">{rule.mode === "enforce" ? "Enforce" : "Report only"}</span>
        </div>
      </div>

      <Card>
        <CardHeader title="What it does" />
        <CardBody className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">When </span>
            {TRIGGER_LABEL[rule.triggerType] ?? rule.triggerType}
            {rule.triggerAttribute ? ` (${rule.triggerAttribute})` : ""}
          </p>
          {rule.condition !== "true" ? (
            <p>
              <span className="text-muted-foreground">If </span>
              <code className="text-xs">{rule.condition}</code>
            </p>
          ) : null}
          {rule.effects.map((e, i) =>
            e.type === "add_to_group" || e.type === "assign_package" ? (
              <p key={i}>
                <span className="text-muted-foreground">{e.type === "add_to_group" ? "Add to the group " : "Assign the package "}</span>
                {targetName(String(e.params.group ?? e.params.package ?? ""))}
                <span className="text-muted-foreground">{e.params.approval === "automatic" ? ", automatically" : ", once a person approves"}</span>
              </p>
            ) : e.type === "open_task" ? (
              <p key={i}>
                <span className="text-muted-foreground">Open a task for {e.params.assignee === "manager" ? "the manager" : "identity administrators"}: </span>
                {value(e.params.title)}
              </p>
            ) : (
              <p key={i}>
                <span className="text-muted-foreground">Set </span>
                {String(e.params.attribute)} <span className="text-muted-foreground">to</span> <code className="text-xs">{value(e.params.value)}</code>
              </p>
            ),
          )}
          {step !== "none" ? (
            <div className="pt-2">
              <RuleNextStep ruleId={rule.id} step={step} />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent runs" description={rule.versions.length ? `Version ${rule.versions[0].version} published ${fmt(rule.versions[0].publishedAt)}` : "Not published yet"} />
        {runs.length ? (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <Link href={`/identities/${r.subjectId}`} className="font-medium text-primary hover:underline">
                    Identity
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {OUTCOME[r.outcome] ?? r.outcome} · v{r.ruleVersion}
                    {r.detail ? ` · ${r.detail}` : ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{fmt(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No runs yet.</p>
        )}
      </Card>

      {canManage && rule.status !== "retired" ? (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Edit or retire</summary>
          <div className="mt-4 space-y-4">
            <RuleForm ruleId={rule.id} initial={initial} settable={settable} targets={targets} />
            <RetireRuleButton ruleId={rule.id} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
