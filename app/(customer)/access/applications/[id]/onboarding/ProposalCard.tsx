import type { StoredProposal } from "@/modules/integrations/service";
import { Badge, type BadgeTone } from "@/modules/ui";
import { ONBOARDING_OPERATION_LABEL, REQUEST_POLICY_LABEL, CERTIFICATION_POLICY_LABEL } from "../../labels";
import { ProposalDecisionForm } from "./ProposalForms";

// INTEGRATION-P0-12 — one onboarding proposal, laid out as spec §8.2's
// output: the proposal, assumptions, confidence, evidence, unresolved
// questions, destructive actions and suggested tests.

const CONFIDENCE_TONE: Record<string, BadgeTone> = { high: "success", medium: "warning", low: "danger" };

function List({ title, items, tone }: { title: string; items: string[]; tone?: "warning" | "danger" }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className={`mt-1 list-disc space-y-0.5 pl-5 text-sm ${tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground"}`}>
        {items.map((i) => (
          <li key={i} className="break-words">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Choice({ label, value, confidence, candidates }: { label: string; value: string | null; confidence: string; candidates: string[] }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">
        {value ? <span className="font-mono text-xs text-foreground">{value}</span> : <span className="text-warning">Not found</span>}{" "}
        <Badge tone={CONFIDENCE_TONE[confidence]}>{confidence}</Badge>
        {candidates.length > 1 ? <span className="mt-0.5 block text-xs text-muted-foreground">Also: {candidates.filter((c) => c !== value).slice(0, 4).join(", ")}</span> : null}
      </dd>
    </div>
  );
}

export function ProposalCard({ stored, canDecide, canApply }: { stored: StoredProposal; canDecide: boolean; canApply: boolean }) {
  const p = stored.proposal;
  const ops = Object.entries(p.operations) as [keyof typeof ONBOARDING_OPERATION_LABEL, { supported: boolean; evidence: string | null }][];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CONFIDENCE_TONE[p.overallConfidence]}>{p.overallConfidence} confidence</Badge>
        <Badge tone="neutral">{p.inputKind === "openapi" ? "From an OpenAPI document" : "From a sample account"}</Badge>
        <Badge tone={stored.aiUsed && !stored.aiError ? "info" : "neutral"}>{stored.aiUsed ? (stored.aiError ? "AI step failed" : `Refined by AI (${stored.aiProvider})`) : "No AI used"}</Badge>
        {stored.status !== "PROPOSED" ? <Badge tone={stored.status === "APPLIED" ? "success" : "neutral"}>{stored.status === "APPLIED" ? "Applied" : "Dismissed"}</Badge> : null}
      </div>
      <List title="Warnings" items={p.warnings} tone="danger" />

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Choice label="Account identifier" value={p.identifier.field} confidence={p.identifier.confidence} candidates={p.identifier.candidates} />
        <Choice
          label={`Correlation${p.correlation.identityField ? ` (to identity ${p.correlation.identityField})` : ""}`}
          value={p.correlation.accountField}
          confidence={p.correlation.confidence}
          candidates={p.correlation.candidates}
        />
        <Choice label="Entitlements" value={p.entitlementField.field} confidence={p.entitlementField.confidence} candidates={p.entitlementField.candidates} />
        <div>
          <dt className="text-xs text-muted-foreground">Risk</dt>
          <dd className="mt-0.5 text-sm text-foreground">
            {p.risk.dataClassification ?? "Unknown"}
            {p.risk.sensitiveFields.length ? <span className="block text-xs text-muted-foreground">Because of {p.risk.sensitiveFields.join(", ")}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Request policy</dt>
          <dd className="mt-0.5 text-sm text-foreground">{REQUEST_POLICY_LABEL[p.requestPolicy]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Certification</dt>
          <dd className="mt-0.5 text-sm text-foreground">{CERTIFICATION_POLICY_LABEL[p.certificationPolicy]}</dd>
        </div>
      </dl>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">Operations the API appears to support</h4>
        <ul className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {ops.map(([k, v]) => (
            <li key={k} className="min-w-0">
              <span className={v.supported ? "text-foreground" : "text-muted-foreground"}>{ONBOARDING_OPERATION_LABEL[k]}</span>
              {v.supported ? <span className="ml-1 font-mono text-xs text-muted-foreground">{v.evidence}</span> : <span className="ml-1 text-xs text-muted-foreground">not found</span>}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">Not applied: an operation is enabled only when the connector declares it and a person turns it on.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <List title="Unresolved questions" items={p.unresolvedQuestions} tone="warning" />
        <List title="Destructive actions" items={p.destructiveActions} tone="danger" />
        <List title="Assumptions" items={p.assumptions} />
        <List title="Suggested tests" items={p.suggestedTests} />
        <List title="Evidence" items={p.evidence} />
        <List title="AI suggestions set aside (not in the input)" items={stored.aiRejected} tone="warning" />
      </div>
      {stored.aiError ? <p className="text-xs text-muted-foreground">{stored.aiError}</p> : null}

      {stored.status === "PROPOSED" && canDecide ? <ProposalDecisionForm applicationId={stored.applicationId} proposalId={stored.id} canApply={canApply} /> : null}
    </div>
  );
}
