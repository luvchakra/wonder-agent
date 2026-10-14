import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { pageRef } from "@/lib/refs/objectRef";
import { getClassificationRule, listClassificationRuns, listLiveApplications } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader } from "@/modules/ui";
import { ClassificationNextStep, ClassificationRuleForm, RetireClassificationRule, type ClassificationFormValues } from "../ClassificationForms";

export const metadata = { title: "Classification rule" };

const OUTCOME: Record<string, string> = {
  applied: "Applied",
  reported: "Would apply (report only)",
  not_matched: "Condition not met",
  out_of_scope: "Out of scope",
  skipped: "Left as it was",
  error: "Error",
};
const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const shown = (v: unknown) => (v && typeof v === "object" ? JSON.stringify(v) : v === null || v === undefined || v === "" ? "(empty)" : String(v));

// ACCESS-P0-33 — one classification rule: what it does, its one next step, its recent runs; editing and retiring folded.
export default async function ClassificationRulePage({ params }: { params: Promise<{ ruleId: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  // FOUNDATION-P0-34: the URL carries the rule's number; an old UUID link redirects.
  const ruleId = await pageRef(tenantId, "entitlement_classification_rules", (await params).ruleId, (ref) => `/access/classification-rules/${ref}`);
  const canManage = ctx.permissions.includes("access.manage");
  const [rule, runs, applications] = await Promise.all([
    getClassificationRule(tenantId, ruleId),
    listClassificationRuns(tenantId, ruleId, 20),
    canManage ? listLiveApplications(tenantId) : Promise.resolve([]),
  ]);
  if (!rule) notFound();
  const status =
    rule.status === "retired"
      ? "Retired"
      : rule.publishRequestedBy
        ? "Waiting for approval"
        : rule.status === "published"
          ? rule.unpublishedChanges
            ? `v${rule.publishedVersion} live · changes not published`
            : `v${rule.publishedVersion} live`
          : "Draft";
  const step =
    rule.status === "retired" || !canManage
      ? "none"
      : rule.publishRequestedBy
        ? rule.publishRequestedBy === ctx.userId
          ? "waiting"
          : "approve"
        : !rule.unpublishedChanges
          ? "none"
          : rule.lastSimulatedAt
            ? "request"
            : "simulate";
  const effect = rule.effects[0];
  const appName = (id: string) => applications.find((a) => a.id === id)?.name ?? "an application";
  const initial: ClassificationFormValues = {
    name: rule.name,
    triggerType: rule.triggerType,
    applicationId: rule.applicationIds[0] ?? "",
    condition: rule.condition === "true" ? "" : rule.condition,
    field: String(effect?.params.attribute ?? "privilegeLevel"),
    value: effect?.params.value === null || effect?.params.value === undefined ? "" : String(effect.params.value),
    mode: rule.mode,
  };
  return (
    <div className="space-y-6">
      <Link href="/access/classification-rules" className="text-sm font-medium text-primary hover:underline">
        ← Classification rules
      </Link>
      <div className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{rule.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.endsWith("live") ? "success" : status === "Waiting for approval" ? "warning" : "neutral"}>{status}</Badge>
          <span className="text-xs text-muted-foreground">{rule.mode === "enforce" ? "Enforce" : "Report only"}</span>
        </div>
      </div>
      <Card>
        <CardHeader title="What it does" />
        <CardBody className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">When an entitlement is </span>
            {rule.triggerType === "entitlement.changed" ? "changed by its source" : "imported or created"}
            {rule.applicationIds.length ? ` in ${rule.applicationIds.map(appName).join(", ")}` : ""}
          </p>
          {rule.condition !== "true" ? (
            <p>
              <span className="text-muted-foreground">If </span>
              <code className="text-xs">{rule.condition}</code>
            </p>
          ) : null}
          {rule.effects.map((e, i) => (
            <p key={i}>
              <span className="text-muted-foreground">Set </span>
              {String(e.params.attribute)} <span className="text-muted-foreground">to</span> <code className="text-xs">{shown(e.params.value)}</code>
            </p>
          ))}
          {step !== "none" ? (
            <div className="pt-2">
              <ClassificationNextStep ruleId={rule.id} step={step} />
            </div>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent runs" />
        {runs.length ? (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0 text-muted-foreground">
                  {OUTCOME[r.outcome] ?? r.outcome} · v{r.ruleVersion}
                  {r.detail ? ` · ${r.detail}` : ""}
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
            <ClassificationRuleForm ruleId={rule.id} initial={initial} applications={applications} />
            <RetireClassificationRule ruleId={rule.id} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
