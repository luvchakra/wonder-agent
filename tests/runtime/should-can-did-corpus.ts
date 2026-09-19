import type { ComparisonOutcome, ComparisonOutcomeType, DidTuple } from "@/lib/shared/types/runtime";

/**
 * QA-P0-08 — the runtime event corpus.
 *
 * A deterministic, versioned fixture set covering the six event categories
 * named in docs/plan/11-QA-AGENT-BACKLOG.md's QA-P0-08: an allowed action,
 * CAN-only excessive access (granted but never used), DID-only unexpected
 * behavior (used but not approved), unauthorized-resource access,
 * sensitive-data access, and an unknown/unmappable event. Each case is one
 * agent's full {contract, effective access, runtime DID} triple, small
 * enough to trace by hand.
 *
 * **Reused, not re-authored** (the story's own acceptance criterion): this
 * is the only place these six scenarios are typed out. Both consumers
 * import it rather than inlining their own copies:
 *  - `modules/runtime-assurance/compare.test.ts` (QA-P0-09) feeds each
 *    case's `contract`/`effectiveAccess`/`did` into its mocked
 *    dependencies and asserts the REAL `compareShouldCanDid()` produces
 *    exactly `expectedOutcomes` — this is what keeps `expectedOutcomes`
 *    honest; it is not hand-verified by inspection alone, it is asserted
 *    against the real implementation on every test run.
 *  - `modules/risk/rules.test.ts` reuses the same six cases (their
 *    `contract`/`did`/`expectedOutcomes` shape is exactly what
 *    `evaluateAgentRisk()`'s dependencies need) to prove each category
 *    turns into the right — or, correctly, no — risk finding.
 *
 * The two "unused_capability"-only categories below (`allowed`'s twin,
 * `can_only_unused`) deliberately produce **zero** Risk findings — see the
 * note on that case. That is a real, current product behavior (Risk's
 * `evaluateAgentRisk()` reads `excessive_access` and `behavioral_violation`
 * from the comparison, never `unused_capability`/`unexpected_capability`/
 * `insufficient_access`), not a gap introduced by this corpus. Recorded in
 * docs/design/qa-agent-backlog-audit.md rather than "fixed" here — adding
 * a new Risk category is Risk Agent's own scope (non-negotiable #18).
 *
 * `id` fields throughout are stable, human-readable, and never reused
 * across cases, so failures point straight at the offending case.
 */

export type CorpusEventCategory =
  | "allowed"
  | "can_only_unused"
  | "did_only_unexpected"
  | "unauthorized_resource"
  | "sensitive_data"
  | "unmappable";

/** The subset of AgentContract fields compareShouldCanDid()/evaluateAgentRisk() read. */
export type CorpusContract = {
  purpose: string;
  approvedApplications: string[];
  approvedData: string[];
  approvedActions: string[];
  prohibitedActions: string[];
  prohibitedData: string[];
};

/** The subset of AccessGrant fields getEffectiveAccess() returns that compare.ts reads. */
export type CorpusGrant = {
  id: string;
  application: string;
  entitlementName: string;
  dataClassification: string | null;
};

export type CorpusCase = {
  id: string;
  category: CorpusEventCategory;
  /** What this case demonstrates, and why it produces the outcomes it does. */
  description: string;
  contract: CorpusContract;
  effectiveAccess: CorpusGrant[];
  didTuples: DidTuple[];
  /** Asserted against the real compareShouldCanDid() output — see the module doc comment. */
  expectedOutcomeTypes: ComparisonOutcomeType[];
  expectedOutcomes: ComparisonOutcome[];
};

const NOW = "2026-09-18T00:00:00Z";

function tuple(over: Partial<DidTuple> & Pick<DidTuple, "application" | "sampleEventId">): DidTuple {
  return {
    resource: null,
    action: "read",
    dataClassification: null,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    eventCount: 1,
    ...over,
  };
}

const BASE_ACTIONS = { approvedActions: ["read"], prohibitedActions: [] as string[] };

export const SHOULD_CAN_DID_CORPUS: CorpusCase[] = [
  {
    id: "allowed",
    category: "allowed",
    description:
      "SHOULD, CAN and DID fully agree: the agent's one approved application/data pair has a covering " +
      "entitlement, and runtime activity exercises exactly it. The PRD's own 'nothing to see here' baseline.",
    contract: {
      purpose: "Financial reporting automation",
      approvedApplications: ["Snowflake"],
      approvedData: ["financial reporting"],
      prohibitedData: [],
      ...BASE_ACTIONS,
    },
    effectiveAccess: [
      { id: "grant-allowed-1", application: "Snowflake", entitlementName: "Financial_Reporting_READ", dataClassification: "financial" },
    ],
    didTuples: [
      tuple({ application: "Snowflake", resource: "FinancialReports", dataClassification: "financial", eventCount: 3, sampleEventId: "event-allowed-1" }),
    ],
    expectedOutcomeTypes: ["healthy"],
    expectedOutcomes: [{ type: "healthy", evidence: {} }],
  },

  {
    id: "can_only_unused",
    category: "can_only_unused",
    description:
      "CAN-only excessive access: the agent's contract approves both SAP and Workday for 'reporting' data " +
      "generically (deliberately ONE shared data term across both apps — compareShouldCanDid() builds SHOULD " +
      "as the full cross-product of approvedApplications x approvedData, so two apps with two DIFFERENT data " +
      "terms would each spuriously fail to cover the other's grant; see the compare.ts data-classification " +
      "vocabulary-bridge doc comment). Both apps have a covering entitlement, but only SAP is ever exercised " +
      "in DID — the Workday grant sits unused. Produces unused_capability alone (Workday IS approved, so " +
      "excessive_access does not also fire — this case isolates 'granted but idle' from 'granted without " +
      "approval,' which the next case covers). Risk's evaluateAgentRisk() currently reads only " +
      "excessive_access/behavioral_violation off the comparison, so this produces ZERO risk findings today — " +
      "a real, current gap, not this corpus's error.",
    contract: {
      purpose: "Financial reporting and HR automation",
      approvedApplications: ["SAP", "Workday"],
      approvedData: ["reporting"],
      prohibitedData: [],
      ...BASE_ACTIONS,
    },
    effectiveAccess: [
      { id: "grant-sap", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial_reporting" },
      { id: "grant-workday", application: "Workday", entitlementName: "Workday_HR_READ", dataClassification: "hr_reporting" },
    ],
    didTuples: [tuple({ application: "SAP", resource: "GL", dataClassification: "financial_reporting", sampleEventId: "event-can-only-1" })],
    expectedOutcomeTypes: ["unused_capability"],
    expectedOutcomes: [
      {
        type: "unused_capability",
        evidence: { grantId: "grant-workday", application: "Workday", entitlementName: "Workday_HR_READ" },
      },
    ],
  },

  {
    id: "did_only_unexpected",
    category: "did_only_unexpected",
    description:
      "DID-only unexpected behavior, used but not approved: the agent's contract approves only SAP, but it " +
      "also holds a Workday entitlement (picked up through a broad IAM role, say) and actually exercises it. " +
      "Technically capable (CAN covers it, so unexpected_capability does NOT fire) but not approved " +
      "(behavioral_violation fires); the ungranted-by-contract Workday entitlement is itself excessive_access. " +
      "Distinguish this from 'unauthorized_resource' below by the presence of excessive_access and the " +
      "absence of unexpected_capability — here the agent had real access, just not approved access.",
    contract: {
      purpose: "Financial reporting automation",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
      prohibitedData: [],
      ...BASE_ACTIONS,
    },
    effectiveAccess: [
      { id: "grant-sap-2", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" },
      { id: "grant-workday-2", application: "Workday", entitlementName: "Workday_HR_READ", dataClassification: "hr" },
    ],
    didTuples: [
      tuple({ application: "SAP", resource: "GL", dataClassification: "financial", sampleEventId: "event-unexpected-1" }),
      tuple({ application: "Workday", resource: "EmployeeRecords", dataClassification: "hr", sampleEventId: "event-unexpected-2" }),
    ],
    expectedOutcomeTypes: ["excessive_access", "behavioral_violation"],
    expectedOutcomes: [
      {
        type: "excessive_access",
        evidence: { grantId: "grant-workday-2", application: "Workday", entitlementName: "Workday_HR_READ", dataClassification: "hr" },
      },
      {
        type: "behavioral_violation",
        evidence: { eventId: "event-unexpected-2", application: "Workday", resource: "EmployeeRecords", dataClassification: "hr" },
      },
    ],
  },

  {
    id: "unauthorized_resource",
    category: "unauthorized_resource",
    description:
      "Unauthorized-resource access: the agent's only entitlement is SAP (approved and clean), but runtime " +
      "shows it reading from ShadowDB — an application with no entitlement AND no contract approval at all. " +
      "No excessive_access (there is no CAN grant to flag), but both unexpected_capability (no technical " +
      "access existed) and behavioral_violation (no approval existed either) fire together — the most severe " +
      "combination this corpus models, and Risk's own independent unauthorized_resource check (§rules.ts) " +
      "fires on it too, directly off the DID tuple rather than off these comparison outcomes.",
    contract: {
      purpose: "Financial reporting automation",
      approvedApplications: ["SAP"],
      approvedData: ["financial reporting"],
      prohibitedData: [],
      ...BASE_ACTIONS,
    },
    effectiveAccess: [{ id: "grant-sap-3", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" }],
    didTuples: [
      tuple({ application: "SAP", resource: "GL", dataClassification: "financial", sampleEventId: "event-unauth-1" }),
      tuple({ application: "ShadowDB", resource: "InternalScratch", dataClassification: "internal", sampleEventId: "event-unauth-2" }),
    ],
    expectedOutcomeTypes: ["unexpected_capability", "behavioral_violation"],
    expectedOutcomes: [
      {
        type: "unexpected_capability",
        evidence: { eventId: "event-unauth-2", application: "ShadowDB", resource: "InternalScratch", dataClassification: "internal" },
      },
      {
        type: "behavioral_violation",
        evidence: { eventId: "event-unauth-2", application: "ShadowDB", resource: "InternalScratch", dataClassification: "internal" },
      },
    ],
  },

  {
    id: "sensitive_data",
    category: "sensitive_data",
    description:
      "Sensitive-data access — the product's own central FinanceBot/CustomerDB acceptance scenario " +
      "(CLAUDE.md §11): SAP and Snowflake are both approved for financial-reporting data, but one of the " +
      "agent's Snowflake entitlements grants PII (CustomerDB), which the contract prohibits outright and " +
      "never approved as data. Snowflake itself IS approved, so this is data-classification divergence, not " +
      "an unauthorized application — distinguishing it from the two cases above.",
    contract: {
      purpose: "Financial reporting automation",
      approvedApplications: ["SAP", "Snowflake"],
      approvedData: ["financial reporting"],
      prohibitedData: ["PII"],
      ...BASE_ACTIONS,
    },
    effectiveAccess: [
      { id: "grant-sap-4", application: "SAP", entitlementName: "SAP_READ", dataClassification: "financial" },
      { id: "grant-snow-fin", application: "Snowflake", entitlementName: "Financial_Reporting_READ", dataClassification: "financial" },
      { id: "grant-snow-pii", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
    ],
    didTuples: [
      tuple({
        application: "Snowflake",
        resource: "CustomerDB",
        dataClassification: "PII",
        lastSeenAt: "2026-09-12T10:31:00Z",
        sampleEventId: "event-sensitive-1",
      }),
    ],
    expectedOutcomeTypes: ["excessive_access", "unused_capability", "unused_capability", "behavioral_violation"],
    expectedOutcomes: [
      {
        type: "excessive_access",
        evidence: { grantId: "grant-snow-pii", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" },
      },
      { type: "unused_capability", evidence: { grantId: "grant-sap-4", application: "SAP", entitlementName: "SAP_READ" } },
      {
        type: "unused_capability",
        evidence: { grantId: "grant-snow-fin", application: "Snowflake", entitlementName: "Financial_Reporting_READ" },
      },
      {
        type: "behavioral_violation",
        evidence: { eventId: "event-sensitive-1", application: "Snowflake", resource: "CustomerDB", dataClassification: "PII" },
      },
    ],
  },

  {
    id: "unmappable",
    category: "unmappable",
    description:
      "Unknown/unmappable event: a runtime event whose application never resolved (a connector that " +
      "couldn't map the source system, say). RUNTIME-P0-14 requires this is never silently scored as either " +
      "compliant or a violation — it gets its own unscored_unknown outcome, and Risk's checks (which all " +
      "guard on a non-null application) correctly produce no finding at all for it.",
    contract: {
      purpose: "Financial reporting automation",
      approvedApplications: [],
      approvedData: [],
      prohibitedData: [],
      ...BASE_ACTIONS,
    },
    effectiveAccess: [],
    didTuples: [tuple({ application: null, resource: null, dataClassification: null, sampleEventId: "event-unmappable-1" })],
    expectedOutcomeTypes: ["unscored_unknown"],
    expectedOutcomes: [
      {
        type: "unscored_unknown",
        evidence: { eventId: "event-unmappable-1", resource: null, dataClassification: null, reason: "unresolved_application" },
      },
    ],
  },
];

export function corpusCase(id: string): CorpusCase {
  const found = SHOULD_CAN_DID_CORPUS.find((c) => c.id === id);
  if (!found) throw new Error(`No corpus case named "${id}" — see tests/runtime/should-can-did-corpus.ts`);
  return found;
}
