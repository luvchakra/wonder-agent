import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  getAgent,
  getAgentContract,
  getOwnershipIssues,
  listAgentIdentities,
  listContractVersions,
  listLifecycleEvents,
  listOwners,
  listOwnersForTenant,
  listRelationships,
} from "@/modules/agent-identity/service";
import { compareAccessToContract, getEffectiveAccess } from "@/modules/access-governance/service";
import { listRuntimeEvents } from "@/modules/runtime-assurance/service";
import { getFindings } from "@/modules/risk/service";
import type { ContractComparisonRow } from "@/lib/shared/types/access-governance";
import {
  addRelationshipAction,
  assignOwnerAction,
  createContractAction,
  linkIdentityAction,
  transitionLifecycleAction,
} from "@/app/actions/agents";
import { getGovernancePosture } from "@/modules/certification-compliance/service";
import type { GovernancePosture } from "@/lib/shared/types/compliance";
import type { OwnershipIssue } from "@/lib/shared/types/agent-identity";
import { Badge, StatusBadge, SeverityBadge, Card, CardHeader, CardBody, Button, AgentTabs, EmptyState, NavIcon } from "@/modules/ui";
import { DonutChart } from "@/modules/ui/charts.lazy";
import { AgentPrimaryActionBar } from "./AgentPrimaryActionBar";
import { AgentApiKeysPanel } from "./AgentApiKeysPanel";
import { ReviewOwnershipButton } from "./ReviewOwnershipButton";
import { listAgentApiKeys } from "@/lib/security/agentApiKeys";

/**
 * Ownership issues were being rendered as raw JSON.stringify output —
 * `{"type":"missing_owner","ownerType":"business_owner"}` on a badge. This
 * turns Identity's OwnershipIssue union into the sentence an administrator
 * can act on.
 */
function describeOwnershipIssue(issue: OwnershipIssue): string {
  const label = (ownerType: string) => ownerType.replace(/_/g, " ");
  switch (issue.type) {
    case "missing_owner":
      return `No ${label(issue.ownerType)} assigned`;
    case "missing_recommended_owner":
      return `No ${label(issue.ownerType)} assigned (recommended)`;
    case "inactive_owner":
      return `${label(issue.ownerType)} is no longer an active member`;
    case "ownership_conflict":
      return `One person holds conflicting roles: ${issue.ownerTypes.map(label).join(", ")}`;
    case "delegation_expired":
      return `A delegated owner's delegation expired on ${issue.expiredAt.slice(0, 10)}`;
  }
}

/** Readable labels for Compliance's twelve governance dimensions. */
const DIMENSION_LABEL: Record<string, string> = {
  identity: "Identity",
  ownership: "Ownership",
  purpose: "Purpose",
  access: "Access",
  action_authority: "Action authority",
  certification: "Certification",
  runtime_monitoring: "Runtime monitoring",
  human_oversight: "Human oversight",
  policy_compliance: "Policy compliance",
  lifecycle: "Lifecycle",
  compliance_controls: "Compliance controls",
  evidence_completeness: "Evidence completeness",
};

const LIFECYCLE_STATES = [
  "DISCOVERED",
  "REGISTERED",
  "ASSESSED",
  "APPROVED",
  "PROVISIONED",
  "ACTIVE",
  "CERTIFICATION_DUE",
  "RESTRICTED",
  "SUSPENDED",
  "RETIRED",
] as const;

const OWNER_TYPES = ["business_owner", "technical_owner", "iam_owner", "application_owner", "data_owner", "escalation_owner", "delegated_owner"] as const;
const ENVIRONMENTS = ["production", "staging", "development"] as const;
const ownerTypeLabel = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const AUTONOMY_LEVELS = [
  { value: 0, label: "0 — Human performs action" },
  { value: 1, label: "1 — Agent recommends" },
  { value: 2, label: "2 — Agent acts with human approval" },
  { value: 3, label: "3 — Agent acts autonomously within defined limits" },
  { value: 4, label: "4 — High autonomy with continuous controls" },
] as const;
const RELATIONSHIP_TYPES = ["delegates_to", "depends_on", "shares_credential_with", "orchestrates"] as const;
const IDENTITY_TYPES = ["service_account", "human_delegate", "oauth_client", "workload_identity", "api_key", "mcp_server"] as const;

const LIFECYCLE_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  ACTIVE: "success",
  DISCOVERED: "neutral",
  REGISTERED: "neutral",
  ASSESSED: "info",
  APPROVED: "info",
  PROVISIONED: "info",
  CERTIFICATION_DUE: "warning",
  RESTRICTED: "warning",
  SUSPENDED: "danger",
  RETIRED: "neutral",
};

const CLOSED_FINDING_STATUSES = new Set(["resolved", "false_positive", "exception", "mitigated"]);

function humanize(value: string): string {
  const s = value.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreBand(score: number): { label: string; tone: "danger" | "warning" | "info" | "neutral" } {
  if (score >= 75) return { label: "Critical risk", tone: "danger" };
  if (score >= 50) return { label: "High risk", tone: "warning" };
  if (score >= 25) return { label: "Medium risk", tone: "info" };
  return { label: "Low risk", tone: "neutral" };
}

function Metric({ icon, value, label, tone }: { icon: string; value: number; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <NavIcon name={icon} className={`size-5 ${tone}`} />
      <p className="mt-2 text-xl font-semibold tabular-nums text-card-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const labelClass = "block text-sm font-medium text-muted-foreground";

/** Agent Detail — Overview tab (Identity's own data: lifecycle, ownership,
 * contract/SHOULD, relationships, linked identities). The Access/Runtime/
 * Risk tabs are their owning module's own routes, composed here only via
 * AgentTabs — see EXPERIENCE-P0-03. */
export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("agent.read");

  const agent = await getAgent(ctx.tenantId!, id);
  if (!agent) notFound();

  const [
    owners,
    ownershipIssues,
    contract,
    contractVersions,
    lifecycleEvents,
    relationships,
    identities,
    posture,
    effectiveAccess,
    comparison,
    recentEvents,
    findings,
    tenantOwners,
    apiKeys,
  ] = await Promise.all([
      listOwners(ctx.tenantId!, id),
      getOwnershipIssues(ctx.tenantId!, id, agent.criticality),
      getAgentContract(id),
      listContractVersions(ctx.tenantId!, id),
      listLifecycleEvents(ctx.tenantId!, id),
      listRelationships(ctx.tenantId!, id),
      listAgentIdentities(ctx.tenantId!, id),
      // COMPLIANCE-P0-07's published read-model drives the design's
      // "Governance Posture" panel. Tolerated as null rather than 500ing
      // the whole agent page if one of the modules it consults is
      // unavailable — the panel says so instead.
      getGovernancePosture(ctx.tenantId!, id).catch(() => null as GovernancePosture | null),
      // Agent 360 panels (2026-09-25 light-console rebuild) — each from its
      // owning module's published contract, in the same parallel wave.
      getEffectiveAccess(ctx.tenantId!, id),
      // Throws NO_ACTIVE_CONTRACT when there is nothing to compare against;
      // the panel then says so rather than inventing SHOULD.
      compareAccessToContract(ctx.tenantId!, id).catch(() => null as ContractComparisonRow[] | null),
      listRuntimeEvents(ctx.tenantId!, { agentId: id, limit: 5 }),
      getFindings(ctx.tenantId!, { agentId: id }),
      // Owner names (listOwners carries only user ids).
      listOwnersForTenant(ctx.tenantId!),
      // FOUNDATION-P0-17 — Runtime Gateway credentials (prefixes only).
      listAgentApiKeys(ctx.tenantId!, id),
    ]);

  const ownerNames = new Map(
    tenantOwners.filter((o) => o.agentId === id).map((o) => [o.userId, o.userDisplayName?.trim() || o.userEmail]),
  );
  const ownerName = (userId: string | undefined) => (userId ? ownerNames.get(userId) ?? userId : null);
  const nowIso = new Date().toISOString();

  const applications = new Set(effectiveAccess.map((g) => g.application).filter(Boolean)).size;
  const entitlements = new Set(effectiveAccess.map((g) => g.entitlementId)).size;
  const dataClasses = new Set(effectiveAccess.map((g) => g.dataClassification).filter(Boolean)).size;
  const privileged = effectiveAccess.filter((g) => g.privilegeLevel === "elevated" || g.privilegeLevel === "admin").length;

  const openFindings = findings.filter((f) => !CLOSED_FINDING_STATUSES.has(f.status));
  const findingsByCategory = new Map<string, number>();
  for (const f of openFindings) findingsByCategory.set(f.category, (findingsByCategory.get(f.category) ?? 0) + 1);
  const unapproved = (comparison ?? []).filter((r) => r.classification === "excessive" || r.classification === "unknown");

  const dimensions = posture?.dimensions ?? [];
  const applicableDimensions = dimensions.filter((d) => d.status !== "not_applicable");
  const governedDimensions = applicableDimensions.filter((d) => d.status === "governed");
  const postureScore =
    applicableDimensions.length === 0 ? null : Math.round((governedDimensions.length / applicableDimensions.length) * 100);
  const agentDisplayName = agent.displayName?.trim() || agent.agentName;

  const transitionWithId = transitionLifecycleAction.bind(null, id);
  const assignOwnerWithId = assignOwnerAction.bind(null, id);
  const createContractWithId = createContractAction.bind(null, id);
  const addRelationshipWithId = addRelationshipAction.bind(null, id);
  const linkIdentityWithId = linkIdentityAction.bind(null, id);

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/agents" className="hover:text-foreground hover:underline">
          Agents
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{agentDisplayName}</span>
      </nav>

      {/* Identity header, per the supplied design: a source tile, the name
          with its status badges, the one-line description, and the primary
          actions on the right. */}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold uppercase text-muted-foreground"
        >
          {(agent.sourceSystem?.trim() || agentDisplayName).slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{agentDisplayName}</h1>
            <StatusBadge tone={LIFECYCLE_TONE[agent.lifecycleState] ?? "neutral"}>{humanize(agent.lifecycleState)}</StatusBadge>
            <SeverityBadge severity={agent.criticality} />
            <Badge tone="neutral">{agent.environment}</Badge>
          </div>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            {agent.description?.trim() || agent.purpose?.trim() || `${agent.agentType}${agent.sourceSystem ? ` · ${agent.sourceSystem}` : ""}`}
          </p>
        </div>
        {/* Full width below xl so the buttons wrap onto the next line on a
            phone or tablet, instead of one unbreakable row pushing the page
            sideways; beside the title from xl. */}
        <div className="w-full xl:w-auto xl:max-w-[50%]">
          <AgentPrimaryActionBar agentId={id} agentName={agent.agentName} />
        </div>
      </div>

      <AgentTabs agentId={id} active="overview" />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* EXPERIENCE-P0-12 — PRD §35's worked layout header fields, now the
            design's "Agent Information" panel. */}
        <Card>
          <CardHeader title="Agent information" />
          <CardBody>
            <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="truncate text-foreground">{agent.agentName}</dd>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="text-foreground">{agent.description?.trim() || "—"}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="truncate text-foreground">{agent.agentType}{agent.agentFramework ? ` (${agent.agentFramework})` : ""}</dd>
              <dt className="text-muted-foreground">Business owner</dt>
              <dd className="truncate text-foreground">{ownerName(owners.find((o) => o.ownerType === "business_owner")?.userId) ?? "—"}</dd>
              <dt className="text-muted-foreground">Technical owner</dt>
              <dd className="truncate text-foreground">{ownerName(owners.find((o) => o.ownerType === "technical_owner")?.userId) ?? "—"}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="truncate text-foreground">{agent.sourceSystem ?? "Registered directly"}</dd>
              <dt className="text-muted-foreground">IAM identity</dt>
              <dd className="truncate text-foreground">
                {identities.length > 0 ? `${identities[0].identityType}: ${identities[0].externalReference}` : "—"}
              </dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="truncate text-foreground">{agent.createdAt.slice(0, 10)}</dd>
              <dt className="text-muted-foreground">Last activity</dt>
              <dd className="truncate text-foreground">{agent.lastSeenAt?.slice(0, 16).replace("T", " ") ?? "Never observed"}</dd>
              <dt className="text-muted-foreground">Next certification</dt>
              <dd className="truncate text-foreground">{agent.nextReviewAt?.slice(0, 10) ?? "Not scheduled"}</dd>
            </dl>
          </CardBody>
        </Card>

        {/* Effective access (CAN) at a glance — Access Agent's contract. */}
        <Card>
          <CardHeader
            title="Key metrics"
            description="Effective access (CAN), from connected IAM data"
            actions={
              <Link href={`/access/agents/${id}`} className="text-xs font-medium text-primary hover:underline">
                View access
              </Link>
            }
          />
          <CardBody className="grid grid-cols-2 gap-3">
            <Metric icon="LayoutDashboard" tone="text-primary" value={applications} label="Applications" />
            <Metric icon="KeyRound" tone="text-violet" value={entitlements} label="Entitlements" />
            <Metric icon="ScrollText" tone="text-success" value={dataClasses} label="Data classifications" />
            <Metric icon="ShieldAlert" tone="text-destructive" value={privileged} label="Privileged grants" />
          </CardBody>
        </Card>

        {/* SHOULD beside CAN: the approved purpose and actions, then the
            effective access the contract does not cover. */}
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Purpose & approved access" description="The agent contract (SHOULD) against effective access (CAN)" />
          <CardBody className="space-y-4">
            {contract ? (
              <>
                <div className="rounded-lg border border-success/25 bg-success/[0.06] p-3">
                  <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                    <span aria-hidden="true" className="text-success">✓</span>
                    {contract.purpose}
                  </p>
                  {contract.approvedActions?.length ? (
                    <ul className="mt-2 space-y-1 pl-6 text-sm text-muted-foreground">
                      {contract.approvedActions.slice(0, 5).map((a) => (
                        <li key={a}>
                          <span className="sr-only">Approved: </span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className={unapproved.length ? "rounded-lg border border-destructive/25 bg-destructive/[0.05] p-3" : "rounded-lg border border-border p-3"}>
                  <p className="text-sm font-medium text-foreground">
                    {unapproved.length
                      ? `${unapproved.length} effective grant${unapproved.length === 1 ? "" : "s"} outside the contract`
                      : "All effective access is covered by the contract"}
                  </p>
                  {unapproved.length ? (
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {unapproved.slice(0, 4).map((r, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-destructive" />
                          <span className="min-w-0 truncate">
                            {r.application ?? "Unknown application"} · {r.entitlement ?? "—"}
                          </span>
                          <Badge tone={r.classification === "excessive" ? "danger" : "neutral"} className="ml-auto">
                            {r.classification === "excessive" ? "Excessive" : "Unclassified"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            ) : (
              <EmptyState title="No active contract" description="Approved purpose (SHOULD) is undefined until a contract is published below." />
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Recent activity"
            actions={
              <Link href={`/runtime/agents/${id}`} className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          <CardBody>
            {recentEvents.events.length === 0 ? (
              <EmptyState title="No runtime activity observed" />
            ) : (
              <ul className="divide-y divide-border">
                {recentEvents.events.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {e.eventTime.slice(5, 16).replace("T", " ")}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs">{e.action}</span>
                      <span className="text-muted-foreground"> · {e.resource ?? e.application ?? e.tool ?? "—"}</span>
                    </span>
                    <Badge tone={e.success ? "success" : "danger"}>{e.success ? "Succeeded" : "Failed"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Risk summary"
            actions={
              <Link href={`/risk/agents/${id}`} className="text-xs font-medium text-primary hover:underline">
                View findings
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {agent.riskScore === null ? (
              <p className="text-sm text-muted-foreground">This agent has not been risk-evaluated yet.</p>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <Badge tone={scoreBand(agent.riskScore).tone}>{scoreBand(agent.riskScore).label}</Badge>
                <span className="text-right">
                  <span className="block text-xs text-muted-foreground">Risk score</span>
                  <span className="text-lg font-semibold tabular-nums text-card-foreground">{Math.round(agent.riskScore)}/100</span>
                </span>
              </div>
            )}
            {openFindings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open findings.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {[...findingsByCategory.entries()].map(([category, n]) => (
                  <li key={category} className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-destructive" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{humanize(category)}</span>
                    <span className="tabular-nums text-foreground">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* The design's "Governance Posture" ring. Compliance Agent's
            already-published read-model — twelve deterministic dimensions,
            each with its own reason — not a score invented here. */}
        <Card>
          <CardHeader
            title="Governance posture"
            description={posture ? `${governedDimensions.length} of ${applicableDimensions.length} applicable dimensions governed` : undefined}
          />
          <CardBody>
            {postureScore === null ? (
              <EmptyState title="Governance posture is not available for this agent yet" />
            ) : (
              <>
                <DonutChart
                  className="justify-center"
                  size={132}
                  centerValue={postureScore}
                  centerLabel="/ 100"
                  slices={[
                    { label: "Governed", value: governedDimensions.length, color: "var(--color-success)" },
                    {
                      label: "Gap",
                      value: applicableDimensions.length - governedDimensions.length,
                      color: "var(--color-destructive)",
                    },
                  ]}
                />
                <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
                  {applicableDimensions.map((d) => (
                    <li key={d.dimension} className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className={d.status === "governed" ? "text-success" : "text-destructive"}
                      >
                        {d.status === "governed" ? "✓" : "✕"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.reason}>
                        {DIMENSION_LABEL[d.dimension] ?? d.dimension}
                      </span>
                      <span className="sr-only">{d.status === "governed" ? "governed" : "gap"}: {d.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <h2 className="pt-2 text-base font-semibold text-foreground">Governance &amp; configuration</h2>

      <Card>
        <CardHeader title="Lifecycle" description="State transition history and pending ownership issues." />
        <CardBody className="space-y-3">
          {ownershipIssues.length > 0 && (
            <ul className="space-y-1">
              {ownershipIssues.map((issue, i) => (
                <li key={i}>
                  <Badge tone="warning">{describeOwnershipIssue(issue)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {lifecycleEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lifecycle transitions recorded yet.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {lifecycleEvents.map((e) => (
                <li key={e.id}>
                  <span className="text-muted-foreground">{e.createdAt}:</span> {e.fromState ?? "(none)"} → <strong className="text-foreground">{e.toState}</strong> — {e.reason}
                </li>
              ))}
            </ul>
          )}
          <form action={transitionWithId} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div>
              <label className={labelClass}>New state</label>
              <select name="toState" defaultValue={LIFECYCLE_STATES[0]} className={inputClass}>
                {LIFECYCLE_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[12rem]">
              <label className={labelClass}>Reason</label>
              <input name="reason" placeholder="reason" required className={inputClass} />
            </div>
            <Button type="submit" variant="secondary">
              Transition
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card className="scroll-mt-4">
        <div id="owners" />
        <CardHeader title="Owners" description="Accountable humans for this agent, per non-negotiable #11." />
        <CardBody className="space-y-3">
          {owners.length === 0 ? (
            <EmptyState title="No owner assigned" description="An unowned agent is a governance gap — assign at least one owner." />
          ) : (
            <ul className="space-y-2 text-sm text-muted-foreground">
              {owners.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge tone="neutral">{ownerTypeLabel(o.ownerType)}</Badge>
                  <span className="min-w-0 break-words text-foreground">{ownerName(o.userId)}</span>
                  {o.delegationExpiresAt ? (
                    <span className={o.delegationExpiresAt < nowIso ? "text-destructive" : undefined}>
                      {o.delegationExpiresAt < nowIso ? "Delegation expired" : "Delegated until"} {o.delegationExpiresAt.slice(0, 10)}
                    </span>
                  ) : null}
                  <span className="text-xs">{o.lastReviewedAt ? `Confirmed ${o.lastReviewedAt.slice(0, 10)}` : "Not yet confirmed"}</span>
                </li>
              ))}
            </ul>
          )}
          {owners.length > 0 ? <ReviewOwnershipButton agentId={id} /> : null}
          <form action={assignOwnerWithId} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label>
              <span className={labelClass}>Owner type</span>
              <select name="ownerType" defaultValue={OWNER_TYPES[0]} className={inputClass}>
                {OWNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ownerTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[12rem] flex-1">
              <span className={labelClass}>User ID</span>
              <input name="userId" placeholder="user id (uuid)" required className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Delegation ends (delegated owner only)</span>
              <input type="date" name="delegationExpiresOn" className={inputClass} />
            </label>
            <Button type="submit" variant="secondary">
              Assign owner
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card className="scroll-mt-4">
        <div id="contract" />
        <CardHeader title="Agent Contract (SHOULD)" description="Approved purpose, applications, data and actions — the contract SHOULD is measured against." />
        <CardBody className="space-y-3">
          {contract ? (
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Purpose</dt>
                <dd className="text-foreground">{contract.purpose}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Owner summary</dt>
                <dd className="text-foreground">{contract.ownerSummary ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved applications</dt>
                <dd className="text-foreground">{contract.approvedApplications?.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved data</dt>
                <dd className="text-foreground">{contract.approvedData?.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved actions</dt>
                <dd className="text-foreground">{contract.approvedActions?.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Prohibited data / actions</dt>
                <dd className="text-foreground">
                  {contract.prohibitedData?.join(", ") || "—"} / {contract.prohibitedActions?.join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Autonomy level</dt>
                <dd className="text-foreground">{AUTONOMY_LEVELS[contract.autonomyLevel]?.label ?? contract.autonomyLevel}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Allowed tools</dt>
                <dd className="text-foreground">{contract.allowedTools?.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Actions requiring human approval</dt>
                <dd className="text-foreground">{contract.actionsRequiringApproval?.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Required monitoring</dt>
                <dd className="text-foreground">{contract.requiredMonitoring ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Required compliance controls</dt>
                <dd className="text-foreground">{contract.requiredComplianceControls?.join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved users / delegators</dt>
                <dd className="text-foreground">
                  {contract.approvedUsers?.join(", ") || "—"} / {contract.approvedDelegators?.join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Allowed environments</dt>
                <dd className="text-foreground">{contract.allowedEnvironments?.join(", ") || "Any"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contract expires</dt>
                <dd className={contract.expiresAt && contract.expiresAt < nowIso ? "text-destructive" : "text-foreground"}>
                  {contract.expiresAt ? `${contract.expiresAt < nowIso ? "Expired " : ""}${contract.expiresAt.slice(0, 10)}` : "No expiry"}
                </dd>
              </div>
            </dl>
          ) : (
            <EmptyState title="No active contract" description="SHOULD is undefined until a contract is published — see the Risk tab for how this affects findings." />
          )}
          <p className="text-xs text-muted-foreground">{contractVersions.length} version{contractVersions.length === 1 ? "" : "s"} published.</p>
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Publish new contract version</summary>
            <form action={createContractWithId} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className={labelClass}>Purpose *</span>
                <input name="purpose" required className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Owner summary</span>
                <input name="ownerSummary" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Approved applications (comma-separated)</span>
                <input name="approvedApplications" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Approved data (comma-separated)</span>
                <input name="approvedData" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Prohibited data (comma-separated)</span>
                <input name="prohibitedData" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Approved actions (comma-separated)</span>
                <input name="approvedActions" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Prohibited actions (comma-separated)</span>
                <input name="prohibitedActions" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Autonomy level</span>
                <select name="autonomyLevel" defaultValue="0" className={inputClass}>
                  {AUTONOMY_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelClass}>Allowed tools (comma-separated)</span>
                <input name="allowedTools" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Actions requiring human approval (comma-separated)</span>
                <input name="actionsRequiringApproval" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Required monitoring</span>
                <input name="requiredMonitoring" className={inputClass} />
              </label>
              <label className="sm:col-span-2">
                <span className={labelClass}>Required compliance controls (comma-separated)</span>
                <input name="requiredComplianceControls" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Approved users (comma-separated)</span>
                <input name="approvedUsers" className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Approved delegators (comma-separated)</span>
                <input name="approvedDelegators" className={inputClass} />
              </label>
              <fieldset>
                <legend className={labelClass}>Allowed environments (none = any)</legend>
                <div className="flex flex-wrap gap-3 text-sm text-foreground">
                  {ENVIRONMENTS.map((env) => (
                    <label key={env} className="flex items-center gap-1.5">
                      <input type="checkbox" name="allowedEnvironments" value={env} />
                      {ownerTypeLabel(env)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                <span className={labelClass}>Contract expires on</span>
                <input type="date" name="expiresOn" className={inputClass} />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" variant="secondary">
                  Publish new contract version
                </Button>
              </div>
            </form>
          </details>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Relationships" />
        <CardBody className="space-y-3">
          {relationships.length === 0 ? (
            <p className="text-sm text-muted-foreground">No relationships recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {relationships.map((r) => (
                <li key={r.id}>
                  <Badge tone="neutral">{r.relationshipType}</Badge>{" "}
                  <Link href={`/agents/${r.relatedAgentId}`} className="text-primary hover:underline">
                    {r.relatedAgentId}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <form action={addRelationshipWithId} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div>
              <label className={labelClass}>Type</label>
              <select name="relationshipType" defaultValue={RELATIONSHIP_TYPES[0]} className={inputClass}>
                {RELATIONSHIP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[12rem]">
              <label className={labelClass}>Related agent ID</label>
              <input name="relatedAgentId" placeholder="related agent id (uuid)" required className={inputClass} />
            </div>
            <Button type="submit" variant="secondary">
              Add relationship
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Linked Identities" description="Correlated technical identities across integrated IAM/IdP systems." />
        <CardBody className="space-y-3">
          {identities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked identities.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {identities.map((i) => (
                <li key={i.id}>
                  <Badge tone="neutral">{i.identityType}</Badge> {i.externalReference} <span className="text-muted-foreground">({i.sourceSystem}, {i.confidence})</span>
                </li>
              ))}
            </ul>
          )}
          <form action={linkIdentityWithId} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div>
              <label className={labelClass}>Type</label>
              <select name="identityType" defaultValue={IDENTITY_TYPES[0]} className={inputClass}>
                {IDENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className={labelClass}>External reference</label>
              <input name="externalReference" placeholder="external reference" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Source system</label>
              <input name="sourceSystem" placeholder="source system" defaultValue="manual" className={inputClass} />
            </div>
            {/* IDENTITY-P0-14: the person linking says how sure they are; it is recorded and audited. */}
            <div>
              <label className={labelClass} htmlFor="identity-confidence">
                Confidence
              </label>
              <select id="identity-confidence" name="confidence" defaultValue="unverified" className={inputClass}>
                <option value="unverified">Unverified</option>
                <option value="probable">Probable</option>
                <option value="confirmed">Confirmed in the source system</option>
              </select>
            </div>
            <Button type="submit" variant="secondary">
              Link identity
            </Button>
          </form>
        </CardBody>
      </Card>

      <AgentApiKeysPanel
        agentId={id}
        keys={apiKeys}
        canCreate={ctx.permissions.includes("agent.update")}
        canRevoke={ctx.permissions.includes("agent.update") || ctx.permissions.includes("runtime.emergency")}
      />
    </div>
  );
}
