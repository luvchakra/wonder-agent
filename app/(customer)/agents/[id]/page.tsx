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
  listRelationships,
} from "@/modules/agent-identity/service";
import {
  addRelationshipAction,
  assignOwnerAction,
  createContractAction,
  linkIdentityAction,
  transitionLifecycleAction,
} from "@/app/actions/agents";
import { Badge, StatusBadge, SeverityBadge, Card, CardHeader, CardBody, Button, AgentTabs, EmptyState } from "@/modules/ui";

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

const OWNER_TYPES = ["business_owner", "technical_owner", "iam_owner", "application_owner", "data_owner", "escalation_owner"] as const;
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

  const [owners, ownershipIssues, contract, contractVersions, lifecycleEvents, relationships, identities] =
    await Promise.all([
      listOwners(ctx.tenantId!, id),
      getOwnershipIssues(ctx.tenantId!, id, agent.criticality),
      getAgentContract(id),
      listContractVersions(ctx.tenantId!, id),
      listLifecycleEvents(ctx.tenantId!, id),
      listRelationships(ctx.tenantId!, id),
      listAgentIdentities(ctx.tenantId!, id),
    ]);

  const transitionWithId = transitionLifecycleAction.bind(null, id);
  const assignOwnerWithId = assignOwnerAction.bind(null, id);
  const createContractWithId = createContractAction.bind(null, id);
  const addRelationshipWithId = addRelationshipAction.bind(null, id);
  const linkIdentityWithId = linkIdentityAction.bind(null, id);

  return (
    <div className="space-y-4">
      <p>
        <Link href="/agents" className="text-sm text-primary hover:underline">
          ← All agents
        </Link>
      </p>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{agent.agentName}</h1>
          <StatusBadge tone={LIFECYCLE_TONE[agent.lifecycleState] ?? "neutral"}>{agent.lifecycleState}</StatusBadge>
          <SeverityBadge severity={agent.criticality} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.agentType} · {agent.environment}
          {agent.purpose ? ` · ${agent.purpose}` : ""}
        </p>
      </div>

      <AgentTabs agentId={id} active="overview" />

      <Card>
        <CardHeader title="Lifecycle" description="State transition history and pending ownership issues." />
        <CardBody className="space-y-3">
          {ownershipIssues.length > 0 && (
            <ul className="space-y-1">
              {ownershipIssues.map((issue, i) => (
                <li key={i}>
                  <Badge tone="warning">{JSON.stringify(issue)}</Badge>
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

      <Card>
        <CardHeader title="Owners" description="Accountable humans for this agent, per non-negotiable #11." />
        <CardBody className="space-y-3">
          {owners.length === 0 ? (
            <EmptyState title="No owner assigned" description="An unowned agent is a governance gap — assign at least one owner." />
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {owners.map((o) => (
                <li key={o.id}>
                  <Badge tone="neutral">{o.ownerType}</Badge> <span className="ml-1">{o.userId}</span>
                </li>
              ))}
            </ul>
          )}
          <form action={assignOwnerWithId} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div>
              <label className={labelClass}>Owner type</label>
              <select name="ownerType" defaultValue={OWNER_TYPES[0]} className={inputClass}>
                {OWNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[12rem]">
              <label className={labelClass}>User ID</label>
              <input name="userId" placeholder="user id (uuid)" required className={inputClass} />
            </div>
            <Button type="submit" variant="secondary">
              Assign owner
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
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
            <Button type="submit" variant="secondary">
              Link identity
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
