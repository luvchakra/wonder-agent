import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getDiscoveryCandidate } from "@/modules/agent-identity/service";
import { linkDiscoveryCandidateAction, registerDiscoveryCandidateAction } from "@/app/actions/agents";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody, Badge, StatusBadge, Button, TextField, SelectField, EmptyState, type BadgeTone } from "@/modules/ui";
import { IgnoreCandidateButton } from "./IgnoreCandidateButton";

const CONFIDENCE_TONE: Record<string, BadgeTone> = { HIGH: "success", MEDIUM: "warning", LOW: "neutral" };
const STRENGTH_TONE: Record<string, BadgeTone> = { strong: "danger", medium: "warning", weak: "neutral" };
const IDENTITY_TYPES = ["service_account", "human_delegate", "oauth_client", "workload_identity", "api_key", "mcp_server"] as const;

/**
 * Fully Functional Agent Discovery — Candidate Review (spec §21-22, §41-42).
 * A single-candidate projection of `buildDiscoveryInbox()` (never a second
 * query path — `getDiscoveryCandidate()` calls the same function the inbox
 * list uses). Register/Ignore/Link all route through the existing Identity
 * registration + lifecycle + duplicate-candidate services (app/actions/
 * agents.ts) — no second registration state machine, no IAM write anywhere
 * on this page.
 */
export default async function DiscoveryCandidatePage({
  params,
}: {
  params: Promise<{ integrationId: string; externalId: string }>;
}) {
  const { integrationId, externalId } = await params;
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const candidate = await getDiscoveryCandidate(ctx.tenantId!, integrationId, externalId);
  if (!candidate) notFound();

  const canRegister = candidate.category !== "orphaned_identity" && candidate.candidateStatus === "open";
  const canIgnore = candidate.category !== "orphaned_identity" && candidate.candidateStatus === "open";

  return (
    <div className="space-y-4">
      <Link href="/agents/discovery" className="text-sm text-primary hover:underline">
        ← Discovery inbox
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{candidate.displayName}</h1>
            <StatusBadge tone={CONFIDENCE_TONE[candidate.confidenceLevel]}>
              {candidate.confidenceLevel} CONFIDENCE · {candidate.confidenceScore}%
            </StatusBadge>
            <Badge tone="neutral">{candidate.classification.replace(/_/g, " ")}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {candidate.identityType.replace(/_/g, " ")} · via {candidate.integrationName}
          </p>
        </div>
        {canIgnore && (
          <IgnoreCandidateButton sourceSystem={candidate.sourceSystem} sourceObjectId={candidate.externalId} displayName={candidate.displayName} />
        )}
      </div>

      <p className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
        Discovery is read-first. Reviewing, registering, ignoring, or linking this candidate never grants, revokes, or
        modifies access in the source IAM system.
      </p>

      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="text-foreground">{candidate.integrationName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">External ID</dt>
              <dd className="font-mono text-foreground">{candidate.externalId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Identity type</dt>
              <dd className="text-foreground">{candidate.identityType}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Owner (as observed)</dt>
              <dd className="text-foreground">{candidate.owner ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Application</dt>
              <dd className="text-foreground">{candidate.application ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last seen</dt>
              <dd className="text-foreground">{candidate.lastSeenAt ? new Date(candidate.lastSeenAt).toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Change</dt>
              <dd className="text-foreground">{candidate.changeType === "STALE" ? "Not seen in the latest completed sync" : "New"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Candidate status</dt>
              <dd className="text-foreground">{candidate.candidateStatus}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Detection Evidence"
          description="Why was this identified as an AI agent? Deterministic and evidence-backed — never an LLM decision."
        />
        <CardBody>
          {candidate.signals.length === 0 ? (
            <EmptyState
              title="No AI-agent signals detected"
              description="This object showed no AI-platform metadata, naming pattern, or runtime association."
            />
          ) : (
            <ul className="space-y-2">
              {candidate.signals.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{s.signal}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.source} · {s.observedValue}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STRENGTH_TONE[s.strength]}>{s.strength}</Badge>
                    <span className="text-xs text-muted-foreground">+{s.scoreContribution}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Source Evidence"
          description={
            candidate.category === "shadow_ai"
              ? "A summary of the quarantined runtime events. None of them was recorded as this organization's runtime activity."
              : "Raw record as imported by Integration Agent — retained for historical traceability."
          }
        />
        <CardBody>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-foreground">Raw source data</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {JSON.stringify(candidate.raw, null, 2)}
            </pre>
          </details>
        </CardBody>
      </Card>

      {candidate.category === "likely_duplicate" && (
        <Card>
          <CardHeader title="Correlation" description="Why we think this may already be a registered agent." />
          <CardBody className="space-y-2 text-sm">
            <p>
              {Math.round((candidate.duplicateMatchScore ?? 0) * 100)}% match confidence — matched on{" "}
              {candidate.duplicateMatchedKeys?.join(", ") || "name"}.
            </p>
            {candidate.likelyDuplicateOfAgentId && (
              <Link href={`/agents/${candidate.likelyDuplicateOfAgentId}`} className="text-primary hover:underline">
                View matched agent →
              </Link>
            )}
          </CardBody>
        </Card>
      )}

      {candidate.candidateStatus === "open" && (
        <Card>
          <CardHeader
            title="Link to existing agent"
            description="Correlate this source object to a specific agent you choose, without creating a new one."
          />
          <CardBody>
            <form action={linkDiscoveryCandidateAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="sourceSystem" value={candidate.sourceSystem} />
              <input type="hidden" name="sourceObjectId" value={candidate.externalId} />
              <input type="hidden" name="displayName" value={candidate.displayName} />
              <input type="hidden" name="identityType" value={candidate.identityType} />
              <div className="min-w-[16rem] flex-1">
                <TextField
                  label="Existing agent ID"
                  name="matchedAgentId"
                  placeholder="agent id (uuid)"
                  required
                  defaultValue={candidate.likelyDuplicateOfAgentId ?? ""}
                />
              </div>
              <Button type="submit" variant="secondary">
                Link
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {canRegister && (
        <Card>
          <CardHeader
            title="Register Agent"
            description="Registration creates a WonderID governance identity. It does not grant or revoke access in the IAM system."
          />
          <CardBody>
            <form action={registerDiscoveryCandidateAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="sourceSystem" value={candidate.sourceSystem} />
              <input type="hidden" name="sourceObjectId" value={candidate.externalId} />
              <div className="sm:col-span-2">
                <TextField label="Agent name" name="agentName" required defaultValue={candidate.displayName} />
              </div>
              <TextField label="Agent type" name="agentType" required placeholder="chatbot, automation, copilot, pipeline…" />
              <SelectField label="Identity type" name="identityType" defaultValue={candidate.identityType}>
                {IDENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SelectField>
              <div className="sm:col-span-2">
                <TextField label="Purpose" name="purpose" required placeholder="Required for the agent to reach REGISTERED" />
              </div>
              <SelectField label="Environment" name="environment" defaultValue="production">
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="development">development</option>
              </SelectField>
              <div />
              <TextField label="Business owner (user id)" name="businessOwnerUserId" placeholder="required to reach REGISTERED" />
              <TextField label="Technical owner (user id)" name="technicalOwnerUserId" placeholder="required to reach REGISTERED" />
              <div className="sm:col-span-2">
                <Button type="submit">Register Agent</Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Without both owners, the agent is still created (state: DISCOVERED) and flagged with a missing-owner issue
                  on its detail page until owners are assigned — it never fails silently.
                </p>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {candidate.category === "orphaned_identity" && (
        <Card>
          <CardHeader title="Orphaned identity" description="This external identity is already linked, but its owning agent no longer exists or has been retired." />
          <CardBody>
            <p className="text-sm text-muted-foreground">
              Use &ldquo;Link to existing agent&rdquo; above to re-correlate this identity to a different, active agent, or leave
              it as historical evidence.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
