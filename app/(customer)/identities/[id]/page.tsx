import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  getIdentity,
  getIdentityNames,
  listAccountableHumans,
  listAttributeDefinitions,
  listIdentities,
  listIdentityRelationships,
  listHumanLifecycleEvents,
  listLifecycleTasks,
  getOwnershipFootprint,
  allowedTransitions,
  HUMAN_TRANSITIONS,
} from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, EmptyState, LinkButton, TabPanel, Tabs } from "@/modules/ui";
import { AddRelationshipForm, EditIdentityForm, EndRelationshipButton, LifecycleTaskActions, LifecycleTransitionForm } from "../IdentityForms";
import { IDENTITY_TYPE_LABEL, LIFECYCLE_EVENT_LABEL, LIFECYCLE_STATE_LABEL, LIFECYCLE_TASK_LABEL, RELATIONSHIP_LABEL, STATUS_LABEL, STATUS_TONE, TRANSITION_LABEL } from "../labels";

// IDENTITY-P0-15/16/17 — one identity: its details, accountable people,
// relationships and attributes. An AI agent's identity shows the agent's
// own fields and links to the agent, which stays canonical.

const HUMAN_LIFECYCLE_LABEL: Record<string, string> = {
  PRE_JOIN: "Joining",
  ACTIVE: "Active",
  LEAVE_PENDING: "Leaving",
  DISABLED: "Disabled",
  TERMINATED: "Terminated",
  ARCHIVED: "Archived",
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function IdentityDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const [{ id }, { tab: requestedTab }] = await Promise.all([params, searchParams]);
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("identity.manage");
  const identity = await getIdentity(tenantId, id);
  if (!identity) notFound();

  const personIdentity = identity.identityType === "HUMAN" || identity.identityType === "EXTERNAL";
  const [relationships, definitions, refs, people, candidates, lifecycleEvents, lifecycleTasks] = await Promise.all([
    listIdentityRelationships(tenantId, id),
    listAttributeDefinitions(tenantId),
    getIdentityNames(tenantId, [identity.ownerIdentityId, identity.sponsorIdentityId, identity.managerIdentityId].filter(Boolean) as string[]),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
    canManage ? listIdentities(tenantId, { pageSize: 200 }).then((r) => r.rows.map((x) => ({ id: x.id, displayName: x.displayName, identityType: x.identityType }))) : Promise.resolve([]),
    personIdentity ? listHumanLifecycleEvents(tenantId, id) : Promise.resolve([]),
    personIdentity ? listLifecycleTasks(tenantId, { identityId: id }) : Promise.resolve([]),
  ]);
  const openTasks = lifecycleTasks.filter((t) => t.status === "open");
  const footprint = openTasks.some((t) => t.taskType === "transfer_ownership") ? await getOwnershipFootprint(tenantId, id) : null;
  const transitionOptions = allowedTransitions(identity.lifecycleState).map((to) => {
    const event = HUMAN_TRANSITIONS[identity.lifecycleState!][to]!;
    return { toState: to, label: TRANSITION_LABEL[event] ?? to, needsReason: ["leaver", "disabled", "terminated", "hire_cancelled"].includes(event) };
  });

  const ref = (refId: string | null) =>
    refId && refs.get(refId) ? (
      <Link href={`/identities/${refId}`} className="text-primary hover:underline">
        {refs.get(refId)!.displayName}
      </Link>
    ) : null;
  const isAgent = identity.identityType === "AI_AGENT";
  const isPerson = identity.identityType === "HUMAN" || identity.identityType === "EXTERNAL";
  const needsOwner = !isPerson && !isAgent;
  const now = new Date();
  const current = relationships.filter((r) => r.validTo === null || new Date(r.validTo) > now);
  const past = relationships.filter((r) => !current.includes(r));
  const applicable = definitions.filter((d) => d.identityType === null || d.identityType === identity.identityType);
  const storedKeys = Object.keys(identity.attributes);
  const byName = new Map(definitions.map((d) => [d.name, d]));
  const shownKeys = [...new Set([...applicable.filter((d) => d.active).map((d) => d.name), ...storedKeys])];
  const today = now.toISOString().slice(0, 10);
  const expired = identity.identityType === "EXTERNAL" && identity.endDate !== null && identity.endDate < today && identity.status === "active";

  const tabs = [
    { value: "overview", label: "Overview" },
    ...(isPerson ? [{ value: "lifecycle", label: "Lifecycle", count: openTasks.length }] : []),
    { value: "relationships", label: "Relationships", count: current.length },
    { value: "attributes", label: "Attributes", count: storedKeys.length },
    ...(canManage ? [{ value: "edit", label: "Edit" }] : []),
  ];

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/identities" className="hover:text-foreground hover:underline">
          Identities
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{identity.displayName}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">{identity.displayName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="info">{IDENTITY_TYPE_LABEL[identity.identityType]}</Badge>
            <Badge tone={STATUS_TONE[identity.status]}>{STATUS_LABEL[identity.status]}</Badge>
            {identity.privileged ? <Badge tone="warning">Privileged</Badge> : null}
            {expired ? <Badge tone="danger">Past end date</Badge> : null}
            {needsOwner && !identity.ownerIdentityId ? <Badge tone="danger">No owner</Badge> : null}
          </div>
        </div>
        {isAgent && identity.agentId ? (
          <LinkButton href={`/agents/${identity.agentId}`} variant="outline" size="sm">
            Open the AI agent
          </LinkButton>
        ) : null}
      </div>

      {isAgent ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          This identity follows its AI agent: name, type, status, purpose and risk come from the agent. Agent ownership, contract and
          lifecycle are managed on the agent.
        </p>
      ) : null}

      <Card className="p-4">
        <Tabs tabs={tabs} ariaLabel="Identity sections" defaultValue={tabs.some((t) => t.value === requestedTab) ? requestedTab : "overview"}>
          <TabPanel value="overview" className="pt-4">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Email">{identity.email}</Detail>
              <Detail label="Username / account">{identity.username}</Detail>
              <Detail label="Subtype">{identity.subtype}</Detail>
              {isPerson ? <Detail label="Lifecycle">{identity.lifecycleState ? HUMAN_LIFECYCLE_LABEL[identity.lifecycleState] : null}</Detail> : null}
              {!isPerson ? <Detail label="Owner">{ref(identity.ownerIdentityId)}</Detail> : null}
              {identity.identityType === "EXTERNAL" || isAgent ? <Detail label="Sponsor">{ref(identity.sponsorIdentityId)}</Detail> : null}
              {isPerson ? <Detail label="Manager">{ref(identity.managerIdentityId)}</Detail> : null}
              {isPerson ? <Detail label="Job title">{identity.title}</Detail> : null}
              {isPerson ? <Detail label="Department">{identity.department}</Detail> : null}
              {identity.identityType === "EXTERNAL" ? <Detail label="Organization">{identity.organization}</Detail> : null}
              {isPerson ? <Detail label="Location">{identity.location}</Detail> : null}
              {!isPerson ? <Detail label="Purpose">{identity.purpose}</Detail> : null}
              <Detail label="Start date">{identity.startDate}</Detail>
              <Detail label="End date">{identity.endDate}</Detail>
              <Detail label="Source">
                {identity.sourceSystem === "wonderid" ? "WonderID member" : identity.sourceSystem}
                {identity.sourceNativeId ? <span className="block font-mono text-xs text-muted-foreground">{identity.sourceNativeId}</span> : null}
              </Detail>
              {isAgent && identity.riskScore !== null ? <Detail label="Risk score">{identity.riskScore}</Detail> : null}
              <Detail label="Added">{new Date(identity.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Detail>
            </dl>
            <p className="mt-5 text-xs text-muted-foreground">
              Changes to identities are recorded in the{" "}
              <Link href="/audit?objectType=identity" className="text-primary hover:underline">
                audit trail
              </Link>
              .
            </p>
          </TabPanel>

          {isPerson ? (
            <TabPanel value="lifecycle" className="space-y-6 pt-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Lifecycle state</span>
                <Badge tone="info">{identity.lifecycleState ? LIFECYCLE_STATE_LABEL[identity.lifecycleState] : "Not set"}</Badge>
              </div>
              {canManage && identity.lifecycleState ? <LifecycleTransitionForm identityId={identity.id} options={transitionOptions} /> : null}

              <section aria-labelledby="open-work">
                <h2 id="open-work" className="text-sm font-semibold text-foreground">
                  Open work
                </h2>
                {openTasks.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">Nothing open.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {openTasks.map((t) => (
                      <li key={t.id} className="grid grid-cols-1 gap-3 px-3 py-3 lg:grid-cols-[1fr_22rem]">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{LIFECYCLE_TASK_LABEL[t.taskType]?.title ?? t.taskType}</p>
                          <p className="text-xs text-muted-foreground">
                            {LIFECYCLE_EVENT_LABEL[t.eventType] ?? t.eventType} · {LIFECYCLE_TASK_LABEL[t.taskType]?.help}
                            {t.assigneeName ? ` · for ${t.assigneeName}` : ""}
                          </p>
                          {t.taskType === "transfer_ownership" && footprint ? (
                            <p className="mt-1 text-xs text-foreground">
                              {footprint.ownedIdentities + footprint.sponsoredIdentities + footprint.directReports + footprint.ownedAgents === 0
                                ? "Owns, sponsors and manages nothing: close this as Done."
                                : `Owns ${footprint.ownedIdentities} identities, sponsors ${footprint.sponsoredIdentities}, manages ${footprint.directReports}, owns ${footprint.ownedAgents} AI agents.`}
                            </p>
                          ) : null}
                        </div>
                        {canManage ? <LifecycleTaskActions taskId={t.id} taskType={t.taskType} people={people.filter((p) => p.id !== identity.id)} /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="history">
                <h2 id="history" className="text-sm font-semibold text-foreground">
                  History
                </h2>
                {lifecycleEvents.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">No lifecycle events yet.</p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {lifecycleEvents.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-medium text-foreground">{LIFECYCLE_EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                        {e.fromState || e.toState ? (
                          <span className="text-muted-foreground">
                            {e.fromState ? LIFECYCLE_STATE_LABEL[e.fromState] : "New"} → {e.toState ? LIFECYCLE_STATE_LABEL[e.toState] : "—"}
                          </span>
                        ) : null}
                        {e.changedFields.filter((f) => f !== "lifecycleState").length ? (
                          <span className="text-xs text-muted-foreground">({e.changedFields.filter((f) => f !== "lifecycleState").join(", ")})</span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          · {e.origin === "source" ? "from an identity source" : "by a person"} ·{" "}
                          {new Date(e.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {e.note ? <span className="w-full text-xs text-foreground">“{e.note}”</span> : null}
                      </li>
                    ))}
                  </ol>
                )}
                {lifecycleTasks.some((t) => t.status !== "open") ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {lifecycleTasks.filter((t) => t.status !== "open").length} closed task(s); see the{" "}
                    <Link href="/identities/lifecycle?status=all" className="text-primary hover:underline">
                      lifecycle work
                    </Link>{" "}
                    list.
                  </p>
                ) : null}
              </section>
            </TabPanel>
          ) : null}

          <TabPanel value="relationships" className="space-y-5 pt-4">
            {current.length === 0 ? (
              <EmptyState title="No current relationships" description={canManage ? "Add one below." : undefined} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {current.map((r) => {
                  const other = r.other ? (
                    <Link href={`/identities/${r.other.id}`} className="font-medium text-primary hover:underline">
                      {r.other.displayName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">an identity</span>
                  );
                  const sentence =
                    r.direction === "outgoing" ? (
                      <>
                        This identity {RELATIONSHIP_LABEL[r.relationshipType]} {other}
                      </>
                    ) : (
                      <>
                        {other} {RELATIONSHIP_LABEL[r.relationshipType]} this identity
                      </>
                    );
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        {sentence}
                        {r.validTo ? <span className="block text-xs text-muted-foreground">Until {r.validTo.slice(0, 10)}</span> : null}
                      </span>
                      {canManage ? (
                        <EndRelationshipButton identityId={identity.id} relationshipId={r.id} label={`${RELATIONSHIP_LABEL[r.relationshipType]} ${r.other?.displayName ?? ""}`} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {canManage ? (
              <div>
                <h2 className="mb-2 text-sm font-semibold text-foreground">Add a relationship</h2>
                <AddRelationshipForm identityId={identity.id} candidates={candidates} />
              </div>
            ) : null}
            {past.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Ended relationships ({past.length})</summary>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {past.map((r) => (
                    <li key={r.id}>
                      {r.direction === "outgoing" ? "This identity" : (r.other?.displayName ?? "An identity")} {RELATIONSHIP_LABEL[r.relationshipType]}{" "}
                      {r.direction === "outgoing" ? (r.other?.displayName ?? "an identity") : "this identity"} · {r.validFrom.slice(0, 10)} to{" "}
                      {r.validTo?.slice(0, 10)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </TabPanel>

          <TabPanel value="attributes" className="pt-4">
            {shownKeys.length === 0 ? (
              <EmptyState
                title="No attributes"
                description={canManage ? "Define attributes for your organization under Administration → Identity Attributes." : undefined}
              />
            ) : (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shownKeys.map((key) => {
                  const def = byName.get(key);
                  const value = identity.attributes[key];
                  const hidden = def?.sensitive && !canManage;
                  return (
                    <Detail key={key} label={`${def?.displayName ?? key}${def && !def.active ? " (retired)" : ""}`}>
                      {value === undefined || value === null ? null : hidden ? (
                        <span className="text-muted-foreground">Hidden (sensitive)</span>
                      ) : typeof value === "boolean" ? (
                        value ? "Yes" : "No"
                      ) : (
                        String(value)
                      )}
                    </Detail>
                  );
                })}
              </dl>
            )}
          </TabPanel>

          {canManage ? (
            <TabPanel value="edit" className="pt-4">
              <EditIdentityForm
                identity={{
                  id: identity.id,
                  identityType: identity.identityType,
                  displayName: identity.displayName,
                  username: identity.username,
                  email: identity.email,
                  subtype: identity.subtype,
                  status: identity.status,
                  ownerIdentityId: identity.ownerIdentityId,
                  sponsorIdentityId: identity.sponsorIdentityId,
                  managerIdentityId: identity.managerIdentityId,
                  department: identity.department,
                  title: identity.title,
                  location: identity.location,
                  organization: identity.organization,
                  purpose: identity.purpose,
                  startDate: identity.startDate,
                  endDate: identity.endDate,
                  privileged: identity.privileged,
                  attributes: identity.attributes,
                  accountLinked: Boolean(identity.userId) && identity.sourceSystem === "wonderid",
                }}
                people={people.filter((p) => p.id !== identity.id)}
                definitions={definitions}
              />
            </TabPanel>
          ) : null}
        </Tabs>
      </Card>
    </div>
  );
}
