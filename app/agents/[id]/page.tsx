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

const OWNER_TYPES = ["business_owner", "technical_owner", "iam_owner", "application_owner", "data_owner"] as const;
const RELATIONSHIP_TYPES = ["delegates_to", "depends_on", "shares_credential_with", "orchestrates"] as const;
const IDENTITY_TYPES = ["service_account", "human_delegate", "oauth_client", "workload_identity", "api_key", "mcp_server"] as const;

// Bare functional detail screen — Experience Agent (Module 08) owns the
// tabbed layout described in the PRD; this page proves the data/actions work.
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
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/agents">← All agents</Link>
      </p>
      <h1>
        {agent.agentName} <small>({agent.lifecycleState})</small>
      </h1>
      <p>
        Type: {agent.agentType} · Criticality: {agent.criticality} · Environment: {agent.environment}
      </p>
      <p>Purpose: {agent.purpose ?? <em>not set</em>}</p>

      <section>
        <h2>Lifecycle</h2>
        {ownershipIssues.length > 0 && (
          <ul>
            {ownershipIssues.map((issue, i) => (
              <li key={i}>{JSON.stringify(issue)}</li>
            ))}
          </ul>
        )}
        <ul>
          {lifecycleEvents.map((e) => (
            <li key={e.id}>
              {e.createdAt}: {e.fromState ?? "(none)"} → {e.toState} — {e.reason}
            </li>
          ))}
        </ul>
        <form action={transitionWithId}>
          <select name="toState" defaultValue={LIFECYCLE_STATES[0]}>
            {LIFECYCLE_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input name="reason" placeholder="reason" required />
          <button type="submit">Transition</button>
        </form>
      </section>

      <section>
        <h2>Owners</h2>
        <ul>
          {owners.map((o) => (
            <li key={o.id}>
              {o.ownerType}: {o.userId}
            </li>
          ))}
        </ul>
        <form action={assignOwnerWithId}>
          <select name="ownerType" defaultValue={OWNER_TYPES[0]}>
            {OWNER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input name="userId" placeholder="user id (uuid)" required />
          <button type="submit">Assign owner</button>
        </form>
      </section>

      <section>
        <h2>Agent Contract (SHOULD)</h2>
        {contract ? (
          <pre>{JSON.stringify(contract, null, 2)}</pre>
        ) : (
          <p>No active contract.</p>
        )}
        <p>Versions: {contractVersions.length}</p>
        <form action={createContractWithId}>
          <label>
            Purpose *
            <input name="purpose" required style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Owner summary
            <input name="ownerSummary" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Approved applications (comma-separated)
            <input name="approvedApplications" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Approved data (comma-separated)
            <input name="approvedData" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Prohibited data (comma-separated)
            <input name="prohibitedData" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Approved actions (comma-separated)
            <input name="approvedActions" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Prohibited actions (comma-separated)
            <input name="prohibitedActions" style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Publish new contract version</button>
        </form>
      </section>

      <section>
        <h2>Relationships</h2>
        <ul>
          {relationships.map((r) => (
            <li key={r.id}>
              {r.relationshipType} → {r.relatedAgentId}
            </li>
          ))}
        </ul>
        <form action={addRelationshipWithId}>
          <select name="relationshipType" defaultValue={RELATIONSHIP_TYPES[0]}>
            {RELATIONSHIP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input name="relatedAgentId" placeholder="related agent id (uuid)" required />
          <button type="submit">Add relationship</button>
        </form>
      </section>

      <section>
        <h2>Linked Identities</h2>
        <ul>
          {identities.map((i) => (
            <li key={i.id}>
              {i.identityType}: {i.externalReference} ({i.sourceSystem}, {i.confidence})
            </li>
          ))}
        </ul>
        <form action={linkIdentityWithId}>
          <select name="identityType" defaultValue={IDENTITY_TYPES[0]}>
            {IDENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input name="externalReference" placeholder="external reference" required />
          <input name="sourceSystem" placeholder="source system" defaultValue="manual" />
          <button type="submit">Link identity</button>
        </form>
      </section>
    </main>
  );
}
