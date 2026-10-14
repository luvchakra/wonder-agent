import { Check, CircleAlert, CircleMinus, CircleX } from "lucide-react";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { getOnboarding, getOnboardingTemplate, missingOnboardingAnswers, onboardingTemplatesFor, type ApplicationOnboarding } from "@/modules/access-governance/service";
import { listIntegrations, listOnboardingProposals } from "@/modules/integrations/service";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard } from "@/modules/ui";
import { cn } from "@/lib/utils";
import type { CatalogRow } from "@/modules/access-governance/service";
import { ONBOARDING_STAGE_LABEL } from "../../labels";
import { TENANT_ADMIN_ROLE } from "@/lib/rbac/delegatedRoleRules";
import { ConfigureOnboardingForm, DecisionForm, QuestionnaireForm, StartOnboardingForm, StepForm } from "./OnboardingForms";
import { ProposalCard } from "./ProposalCard";
import { ProposalRequestForm } from "./ProposalForms";

// ACCESS-P0-16 — onboarding an application, shown in the application's
// Onboarding tab (owner feedback 2026-10-14: the page itself, not a button) (spec §8): configure, validate
// against the §8.5 checklist, simulate against the imported accounts
// (reads only), approve (someone other than the submitter), promote the
// exact approved version.

const STEPS = ["Configure", "Validate", "Simulate", "Approve", "Promote"] as const;

/** How far the current configuration has got: the index of the next step to do. */
function progress(o: ApplicationOnboarding): number {
  if (o.status === "PROMOTED") return 5;
  if (o.status === "APPROVED" && o.approvedHash === o.configHash) return 4;
  if (o.status === "WAITING_FOR_APPROVAL") return 3;
  if (o.validation?.current && o.validation.blockingFailures.length === 0) return 2;
  return 1;
}

function Stepper({ o }: { o: ApplicationOnboarding }) {
  const next = progress(o);
  const failedAt = o.status === "FAILED" ? (o.simulation?.current && !o.simulation.passed ? 2 : 1) : o.status === "REJECTED" ? 3 : -1;
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Onboarding steps">
      {STEPS.map((label, i) => {
        const done = i < next && i !== failedAt;
        const current = i === next && failedAt === -1;
        const failed = i === failedAt;
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", failed ? "bg-destructive" : done ? "bg-success" : current ? "bg-primary" : "bg-muted")} />
            <p className={cn("mt-1.5 truncate text-xs", done || current || failed ? "font-medium text-foreground" : "text-muted-foreground")}>
              <span className="sr-only">{failed ? "Failed: " : done ? "Done: " : current ? "Next: " : ""}</span>
              {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null);

export async function OnboardingPanel({ app, ctx }: { app: CatalogRow; ctx: { tenantId: string; userId: string; permissions: string[]; roles?: string[] } }) {
  const id = app.id;
  const tenantId = ctx.tenantId;
  const canManage = ctx.permissions.includes("access.manage");
  const canPropose = ctx.permissions.includes("integration.update");
  const [o, members, integrations, proposals, templates] = await Promise.all([
    getOnboarding(tenantId, id),
    listTenantMembersWithRoles(tenantId),
    canManage && ctx.permissions.includes("integration.read") ? listIntegrations(tenantId) : Promise.resolve([]),
    ctx.permissions.includes("integration.read") ? listOnboardingProposals(tenantId, id, 3) : Promise.resolve([]),
    canManage ? onboardingTemplatesFor(tenantId, id) : Promise.resolve([]),
  ]);
  // ACCESS-P0-34: the template it started from, for its questionnaire.
  const template = o?.templateId ? await getOnboardingTemplate(tenantId, o.templateId) : null;
  const missing = template ? missingOnboardingAnswers(template.questions, o!.answers) : [];
  const latestProposal = proposals[0] ?? null;
  const name = (userId: string | null) => {
    if (!userId) return null;
    if (userId === ctx.userId) return "you";
    const m = members.find((x) => x.userId === userId);
    return m?.displayName || m?.email || "a former member";
  };

  return (
    <div className="space-y-4">
      {o ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ONBOARDING_STAGE_LABEL[o.status].tone}>{ONBOARDING_STAGE_LABEL[o.status].label}</Badge>
          <span className="text-xs text-muted-foreground">Configuration v{o.configVersion}</span>
        </div>
      ) : null}
      {canPropose || latestProposal ? (
        <Card>
          <CardHeader
            title="Proposed configuration"
            description="From an OpenAPI document or a sample account: a proposal to review, never a change. Applying it only fills the draft below."
          />
          <CardBody className="space-y-6">
            {latestProposal ? <ProposalCard stored={latestProposal} canDecide={canPropose} canApply={canPropose && canManage} /> : null}
            {canPropose && o?.status !== "PROMOTED" ? (
              <div className={latestProposal ? "border-t border-border pt-4" : undefined}>
                <ProposalRequestForm applicationId={id} />
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {!o ? (
        <Card>
          <CardHeader title="Start onboarding" description="Nothing changes in the application until an approved configuration is promoted." />
          <CardBody>
            {app.onboardingStatus === "RETIRED" ? (
              <EmptyState title="Retired" description="A retired application is not onboarded." />
            ) : canManage ? (
              <StartOnboardingForm applicationId={id} templates={templates.map((t) => ({ id: t.id, name: t.name, specific: t.connectionTypeKey !== null }))} />
            ) : (
              <EmptyState title="Not started" description="Someone who can manage access starts onboarding." />
            )}
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardBody>
              <Stepper o={o} />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Configuration" description={o.status === "PROMOTED" ? "Live. A change here starts a new version to validate and approve." : undefined} />
              <CardBody>
                <ConfigureOnboardingForm
                  applicationId={id}
                  config={o.config}
                  configVersion={o.configVersion}
                  integrations={integrations.map((i) => ({ id: i.id, name: i.name }))}
                  disabled={!canManage}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Record" />
              <CardBody>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Version</dt>
                    <dd className="text-foreground">
                      v{o.configVersion} <span className="font-mono text-xs text-muted-foreground">{o.configHash.slice(0, 12)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Submitted</dt>
                    <dd className="text-foreground">{o.submittedBy ? `${name(o.submittedBy)}, ${when(o.submittedAt)}` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Decision</dt>
                    <dd className="text-foreground">
                      {o.approvedBy ? `Approved by ${name(o.approvedBy)}, ${when(o.approvedAt)}` : o.status === "REJECTED" ? "Rejected" : "—"}
                      {o.decisionNote ? <span className="mt-0.5 block text-xs text-muted-foreground">“{o.decisionNote}”</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Promoted</dt>
                    <dd className="text-foreground">
                      {o.promotedAt ? when(o.promotedAt) : "—"}
                      {o.promotedHash && o.promotedHash !== o.configHash ? <span className="mt-0.5 block text-xs text-warning">An earlier version is live.</span> : null}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          </div>

          {template && template.questions.length ? (
            <Card>
              <CardHeader
                title="Questionnaire"
                description={`From the template “${template.name}”. ${missing.length ? `${missing.length} required ${missing.length === 1 ? "question is" : "questions are"} unanswered.` : "Every required question is answered."}`}
              />
              <CardBody>
                {canManage && o.status !== "PROMOTED" ? (
                  <QuestionnaireForm applicationId={id} questions={template.questions} answers={o.answers} />
                ) : (
                  <dl className="space-y-2 text-sm">
                    {template.questions.map((q) => (
                      <div key={q.key}>
                        <dt className="text-xs text-muted-foreground">{q.label}</dt>
                        <dd className="text-foreground">{o.answers[q.key] === undefined ? "—" : o.answers[q.key] === true ? "Yes" : o.answers[q.key] === false ? "No" : String(o.answers[q.key])}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Validate"
              description={
                o.validation
                  ? o.validation.current
                    ? `Checked ${when(o.validation.at)}. ${o.validation.automationReady ? "Automation ready." : "Not automation ready: some operations are fulfilled by hand."}`
                    : "The configuration changed since this check; validate again."
                  : "Checks the configuration and the catalog against the onboarding checklist."
              }
            />
            <CardBody className="space-y-4">
              {o.validation ? (
                <ul className={cn("grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2", !o.validation.current && "opacity-60")}>
                  {o.validation.items.map((item) => (
                    <li key={item.key} className="flex gap-2 text-sm">
                      {item.state === "pass" ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" />
                      ) : item.state === "not_applicable" ? (
                        <CircleMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not applicable" />
                      ) : item.blocking ? (
                        <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed, blocking" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" />
                      )}
                      <span className="min-w-0">
                        <span className="block text-foreground">{item.label}</span>
                        <span className="block text-xs text-muted-foreground">{item.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canManage && o.status !== "PROMOTED" ? (
                <StepForm applicationId={id} step="validate" label={o.validation ? "Validate again" : "Validate"} busy="Validating…" disabledReason={null} variant={o.validation?.current ? "outline" : "default"} />
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Simulate"
              description={
                o.simulation && !o.simulation.current
                  ? "The configuration changed since this simulation; simulate again."
                  : "Plays the configuration against the accounts the connector imported. Nothing is created, changed or removed."
              }
            />
            <CardBody className="space-y-4">
              {o.simulation ? (
                <div className={cn("space-y-3", !o.simulation.current && "opacity-60")}>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <KpiCard size="sm" icon="Users" tone="primary" label="Accounts" value={o.simulation.accounts} />
                    <KpiCard size="sm" icon="Link2" tone="success" label="Matched" value={o.simulation.correlated} />
                    <KpiCard size="sm" icon="UserX" tone={o.simulation.unmatched ? "warning" : "neutral"} label="Orphans" value={o.simulation.unmatched} />
                    <KpiCard size="sm" icon="CircleAlert" tone={o.simulation.ambiguous ? "warning" : "neutral"} label="Ambiguous" value={o.simulation.ambiguous} />
                    <KpiCard size="sm" icon="Ban" tone={o.simulation.missingIdentifier ? "danger" : "neutral"} label="No identifier" value={o.simulation.missingIdentifier} />
                  </div>
                  {o.simulation.problems.length ? (
                    <ul className="space-y-1 text-sm text-destructive">
                      {o.simulation.problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-success">Passed {when(o.simulation.at)}.</p>
                  )}
                </div>
              ) : null}
              {canManage && o.status !== "PROMOTED" ? (
                <StepForm
                  applicationId={id}
                  step="simulate"
                  label={o.simulation ? "Simulate again" : "Simulate"}
                  busy="Simulating…"
                  variant={o.status === "WAITING_FOR_APPROVAL" || o.status === "APPROVED" ? "outline" : "default"}
                  disabledReason={o.validation?.current && o.validation.blockingFailures.length === 0 ? null : "Validate the current configuration first"}
                />
              ) : null}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Approve" description="Someone other than the person who submitted it approves the exact version that was simulated; an administrator may approve their own, with a note." />
              <CardBody>
                {o.status === "WAITING_FOR_APPROVAL" ? (
                  canManage ? (
                    <DecisionForm applicationId={id} ownSubmission={o.submittedBy === ctx.userId} canSelfApprove={(ctx.roles ?? []).includes(TENANT_ADMIN_ROLE)} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Waiting for approval.</p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {o.status === "APPROVED" || o.status === "PROMOTED"
                      ? `Approved by ${name(o.approvedBy) ?? "—"}.`
                      : o.status === "REJECTED"
                        ? "Rejected. Change the configuration and simulate again."
                        : "A passing simulation submits it for approval."}
                  </p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Promote" description="Makes the approved version live and the application active." />
              <CardBody>
                {o.status === "PROMOTED" ? (
                  <p className="text-sm text-success">Live since {when(o.promotedAt)}.</p>
                ) : canManage ? (
                  <StepForm
                    applicationId={id}
                    step="promote"
                    label="Promote"
                    busy="Promoting…"
                    disabledReason={o.status === "APPROVED" && o.approvedHash === o.configHash ? null : "Only an approved, unchanged configuration can be promoted"}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Not promoted yet.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
