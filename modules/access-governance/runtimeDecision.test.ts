// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decideRuntimeRequest, filterToolsForAgent, isMutatingAction, type RuntimeDecisionFacts } from "./runtimeDecision";

/**
 * ACCESS-P0-11 — every branch of the deterministic runtime decision,
 * including the master stories' fail-safe table (§21) and CLAUDE.md §11's
 * FinanceBot scenario.
 */

// FinanceBot, per CLAUDE.md §11: approved for SAP and Snowflake, financial
// reporting data, READ and REPORT; autonomy 3 (acts within limits).
function facts(over: Partial<RuntimeDecisionFacts> = {}, request: Partial<RuntimeDecisionFacts["request"]> = {}): RuntimeDecisionFacts {
  return {
    request: { requestId: "req-1", action: "READ", application: "Snowflake", dataClassification: "financial", ...request },
    tenantActive: true,
    agent: { id: "financebot", lifecycleState: "ACTIVE", environment: "production", criticality: "high", riskScore: 20 },
    identityBelongsToAgent: null,
    contract: {
      approvedApplications: ["SAP", "Snowflake"],
      approvedData: ["financial"],
      prohibitedData: ["pii"],
      approvedActions: ["READ", "REPORT"],
      prohibitedActions: ["DELETE"],
      actionsRequiringApproval: ["EXPORT"],
      allowedTools: [],
      autonomyLevel: 3,
      maximumRisk: "high",
    },
    effectiveApplications: ["Snowflake", "SAP"],
    emergency: { killSwitch: false, suspendedTools: [] },
    runtimePolicies: [],
    ...over,
  };
}

const stepOf = (d: ReturnType<typeof decideRuntimeRequest>, name: string) => d.steps.find((s) => s.step === name);

describe("decideRuntimeRequest — allow path", () => {
  it("allows an approved, effective, low-risk request and explains every step", () => {
    const d = decideRuntimeRequest(facts());
    expect(d.decision).toBe("ALLOW");
    expect(d.code).toBe("ALLOWED");
    expect(d.steps.map((s) => s.step)).toEqual([
      "tenant",
      "identity",
      "lifecycle",
      "emergency",
      "approved_access",
      "effective_access",
      "context",
      "risk",
      "runtime_policy",
    ]);
    expect(d.steps.every((s) => s.outcome === "PASS")).toBe(true);
  });

  it("matches names case-insensitively", () => {
    expect(decideRuntimeRequest(facts({}, { action: "read", application: "snowflake", dataClassification: "FINANCIAL" })).decision).toBe("ALLOW");
  });
});

describe("decideRuntimeRequest — master §21 fail-safe defaults", () => {
  it("unknown identity → DENY", () => {
    expect(decideRuntimeRequest(facts({ agent: null })).code).toBe("UNKNOWN_AGENT");
    expect(decideRuntimeRequest(facts({ identityBelongsToAgent: false })).code).toBe("UNKNOWN_IDENTITY");
  });

  it("unknown resource (application outside effective access) → DENY", () => {
    const d = decideRuntimeRequest(facts({ effectiveApplications: ["SAP"] }));
    expect(d.decision).toBe("DENY");
    expect(stepOf(d, "effective_access")?.code).toBe("NO_EFFECTIVE_ACCESS");
  });

  it("effective access that could not be established → DENY, never allow", () => {
    expect(decideRuntimeRequest(facts({ effectiveApplications: null })).code).toBe("EFFECTIVE_ACCESS_UNKNOWN");
  });

  it("suspended or retired agent → DENY", () => {
    for (const state of ["SUSPENDED", "RETIRED", "DISCOVERED", "REGISTERED", "APPROVED", "PROVISIONED"]) {
      const d = decideRuntimeRequest(facts({ agent: { ...facts().agent!, lifecycleState: state } }));
      expect(d.decision, state).toBe("DENY");
      expect(d.code, state).toBe("AGENT_NOT_OPERATING");
    }
  });

  it("suspended tool and kill switch → DENY", () => {
    expect(decideRuntimeRequest(facts({ emergency: { killSwitch: true, suspendedTools: [] } })).code).toBe("KILL_SWITCH");
    expect(
      decideRuntimeRequest(facts({ emergency: { killSwitch: false, suspendedTools: ["query_db"] } }, { tool: "Query_DB" })).code,
    ).toBe("TOOL_SUSPENDED");
  });

  it("explicit deny (prohibited action or data) → DENY", () => {
    expect(decideRuntimeRequest(facts({}, { action: "delete" })).code).toBe("ACTION_PROHIBITED");
    expect(decideRuntimeRequest(facts({}, { dataClassification: "PII" })).code).toBe("DATA_PROHIBITED");
  });

  it("approval required → REQUIRE_APPROVAL", () => {
    const d = decideRuntimeRequest(facts({}, { action: "EXPORT" }));
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.code).toBe("ACTION_REQUIRES_APPROVAL");
  });

  it("an inactive tenant → DENY, and later steps are skipped, not guessed", () => {
    const d = decideRuntimeRequest(facts({ tenantActive: false }));
    expect(d.code).toBe("TENANT_INACTIVE");
    expect(stepOf(d, "approved_access")?.outcome).toBe("SKIPPED");
  });
});

describe("decideRuntimeRequest — approved access (SHOULD)", () => {
  it("no active contract → DENY: nothing is approved", () => {
    expect(decideRuntimeRequest(facts({ contract: null })).code).toBe("NO_ACTIVE_CONTRACT");
  });

  it("an action the contract never names is not silently allowed", () => {
    expect(decideRuntimeRequest(facts({}, { action: "SUMMARIZE" })).code).toBe("ACTION_NOT_APPROVED");
  });

  it("unapproved application, tool or data → DENY", () => {
    expect(decideRuntimeRequest(facts({ effectiveApplications: ["Salesforce"] }, { application: "Salesforce" })).code).toBe(
      "APPLICATION_NOT_APPROVED",
    );
    const withTools = facts();
    withTools.contract!.allowedTools = ["get_account"];
    expect(decideRuntimeRequest({ ...withTools, request: { ...withTools.request, tool: "delete_account" } }).code).toBe("TOOL_NOT_APPROVED");
    expect(decideRuntimeRequest(facts({}, { dataClassification: "hr" })).code).toBe("DATA_NOT_APPROVED");
  });

  it("autonomy 0 → DENY; autonomy 1–2 → REQUIRE_APPROVAL; autonomy 3+ may act", () => {
    const at = (level: number) => {
      const f = facts();
      f.contract!.autonomyLevel = level;
      return decideRuntimeRequest(f);
    };
    expect(at(0).code).toBe("AUTONOMY_HUMAN_ONLY");
    expect(at(1).decision).toBe("REQUIRE_APPROVAL");
    expect(at(2).code).toBe("AUTONOMY_REQUIRES_APPROVAL");
    expect(at(3).decision).toBe("ALLOW");
    expect(at(4).decision).toBe("ALLOW");
  });
});

describe("decideRuntimeRequest — CLAUDE.md §11 FinanceBot → Snowflake CustomerDB", () => {
  it("SHOULD = financial only, CAN includes CustomerDB, the request for CustomerDB (PII) is denied", () => {
    const d = decideRuntimeRequest(facts({}, { action: "READ", application: "Snowflake", resource: "CustomerDB", dataClassification: "pii" }));
    expect(d.decision).toBe("DENY");
    expect(d.code).toBe("DATA_PROHIBITED");
    // CAN alone never overrides SHOULD: effective access passed, the contract still denied it.
    expect(stepOf(d, "effective_access")?.outcome).toBe("PASS");
  });
});

describe("decideRuntimeRequest — lifecycle RESTRICTED", () => {
  const restricted = () => facts({ agent: { ...facts().agent!, lifecycleState: "RESTRICTED" } });

  it("allows reads with a read-only restriction", () => {
    const d = decideRuntimeRequest(restricted());
    expect(d.decision).toBe("ALLOW_WITH_RESTRICTIONS");
    expect(d.restrictions).toEqual({ readOnly: true });
  });

  it("denies state changes", () => {
    const f = restricted();
    f.contract!.approvedActions.push("UPDATE");
    expect(decideRuntimeRequest({ ...f, request: { ...f.request, action: "UPDATE" } }).code).toBe("AGENT_RESTRICTED");
  });
});

describe("decideRuntimeRequest — context and risk", () => {
  it("a request for another environment than the agent's → DENY", () => {
    expect(decideRuntimeRequest(facts({}, { context: { environment: "staging" } })).code).toBe("ENVIRONMENT_MISMATCH");
  });

  it("master P0-31: high risk + state change + production → REQUIRE_APPROVAL", () => {
    const f = facts({ agent: { ...facts().agent!, riskScore: 60 } }, { action: "REPORT" });
    f.contract!.approvedActions.push("UPDATE");
    expect(decideRuntimeRequest({ ...f, request: { ...f.request, action: "UPDATE" } }).code).toBe("HIGH_RISK_PRODUCTION_MUTATION");
    // Reads by the same agent are not gated on risk.
    expect(decideRuntimeRequest(f).decision).toBe("ALLOW");
  });

  it("critical risk + any state change → REQUIRE_APPROVAL, in any environment", () => {
    const f = facts({ agent: { ...facts().agent!, riskScore: 80, environment: "development" } });
    f.contract!.approvedActions.push("UPDATE");
    f.contract!.maximumRisk = "high";
    expect(decideRuntimeRequest({ ...f, request: { ...f.request, action: "UPDATE" } }).code).toBe("CRITICAL_RISK_MUTATION");
  });

  it("risk above the contract's maximum → REQUIRE_APPROVAL", () => {
    const f = facts({ agent: { ...facts().agent!, riskScore: 55 } });
    f.contract!.maximumRisk = "medium";
    expect(decideRuntimeRequest(f).code).toBe("ABOVE_CONTRACT_MAXIMUM_RISK");
  });

  it("an unscored agent is not blocked on risk", () => {
    expect(stepOf(decideRuntimeRequest(facts({ agent: { ...facts().agent!, riskScore: null } })), "risk")?.code).toBe("NOT_SCORED");
  });
});

describe("decideRuntimeRequest — runtime policies", () => {
  const policy = (action: "block" | "restrict" | "flag", condition: unknown) => ({
    id: `p-${action}`,
    version: 3,
    name: `${action} policy`,
    action,
    rules: [{ id: "r1", condition: condition as never }],
  });

  it("a firing block policy denies, and names the policy and version", () => {
    const d = decideRuntimeRequest(facts({ runtimePolicies: [policy("block", { field: "request.application", op: "eq", value: "snowflake" })] }));
    expect(d.decision).toBe("DENY");
    expect(d.code).toBe("POLICY_BLOCK");
    expect(d.policyId).toBe("p-block");
    expect(d.policyVersion).toBe(3);
  });

  it("a firing restrict policy makes a read read-only, and denies a write", () => {
    const p = policy("restrict", { field: "agent.criticality", op: "eq", value: "high" });
    const read = decideRuntimeRequest(facts({ runtimePolicies: [p] }));
    expect(read.decision).toBe("ALLOW_WITH_RESTRICTIONS");
    expect(read.restrictions).toEqual({ readOnly: true });

    const f = facts({ runtimePolicies: [p] });
    f.contract!.approvedActions.push("UPDATE");
    expect(decideRuntimeRequest({ ...f, request: { ...f.request, action: "UPDATE" } }).code).toBe("POLICY_RESTRICT_READ_ONLY");
  });

  it("a flag policy records but does not change the decision", () => {
    expect(decideRuntimeRequest(facts({ runtimePolicies: [policy("flag", { field: "request.action", op: "eq", value: "read" })] })).decision).toBe(
      "ALLOW",
    );
  });

  it("a block policy that cannot be evaluated goes to review, never to allow", () => {
    const d = decideRuntimeRequest(facts({ runtimePolicies: [policy("block", { field: "request.tool", op: "eq", value: "x" })] }));
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.code).toBe("POLICY_UNEVALUABLE");
  });

  it("the strongest outcome across steps wins (DENY beats REQUIRE_APPROVAL)", () => {
    const d = decideRuntimeRequest(facts({ runtimePolicies: [policy("block", { field: "request.action", op: "eq", value: "export" })] }, { action: "EXPORT" }));
    expect(stepOf(d, "approved_access")?.outcome).toBe("REQUIRE_APPROVAL");
    expect(d.decision).toBe("DENY");
    expect(d.code).toBe("POLICY_BLOCK");
  });
});

describe("isMutatingAction", () => {
  it("recognises state-changing verbs only", () => {
    for (const a of ["UPDATE", "delete_customer", "refund order", "Export", "create_case"]) expect(isMutatingAction(a), a).toBe(true);
    for (const a of ["READ", "get_account", "search_cases", "REPORT", "list"]) expect(isMutatingAction(a), a).toBe(false);
  });
});

describe("decideRuntimeRequest — RUNTIME-P0-18 emergency controls", () => {
  const em = (over: Partial<RuntimeDecisionFacts["emergency"]>) => ({ killSwitch: false, suspendedTools: [], ...over });

  it("a suspended MCP server denies calls through it", () => {
    const d = decideRuntimeRequest(facts({ emergency: em({ suspendedMcpServers: ["Salesforce MCP"] }) }, { mcpServer: "salesforce mcp" }));
    expect(d.code).toBe("MCP_SERVER_SUSPENDED");
  });

  it("a terminated session denies requests in it, and only in it", () => {
    const f = facts({ emergency: em({ terminatedSessions: ["sess-1"] }) }, { context: { sessionId: "sess-1" } });
    expect(decideRuntimeRequest(f).code).toBe("SESSION_TERMINATED");
    const other = facts({ emergency: em({ terminatedSessions: ["sess-1"] }) }, { context: { sessionId: "sess-2" } });
    expect(decideRuntimeRequest(other).decision).toBe("ALLOW");
  });
});

describe("filterToolsForAgent — RUNTIME-P0-18 / master P0-34", () => {
  const base = () => facts();
  const withAllowed = (tools: string[]) => {
    const f = base();
    f.contract!.allowedTools = tools;
    return f;
  };

  it("shows approved tools and hides the rest, with reasons", () => {
    const r = filterToolsForAgent(withAllowed(["get_customer", "search_customer"]), ["get_customer", "delete_customer"]);
    expect(r).toEqual([
      { tool: "get_customer", visible: true, code: "VISIBLE", reason: expect.any(String) },
      { tool: "delete_customer", visible: false, code: "TOOL_NOT_APPROVED", reason: expect.any(String) },
    ]);
  });

  it("an empty allowed list restricts nothing; a suspended tool is still hidden", () => {
    const f = withAllowed([]);
    f.emergency = { killSwitch: false, suspendedTools: ["export_customer_data"] };
    const r = filterToolsForAgent(f, ["get_customer", "export_customer_data"]);
    expect(r.map((t) => t.visible)).toEqual([true, false]);
    expect(r[1].code).toBe("TOOL_SUSPENDED");
  });

  it("hides everything for a kill switch, a suspended server, a non-operating agent, no contract, or an unknown agent", () => {
    const tools = ["a", "b"];
    const ks = base();
    ks.emergency = { killSwitch: true, suspendedTools: [] };
    expect(filterToolsForAgent(ks, tools).every((t) => !t.visible && t.code === "KILL_SWITCH")).toBe(true);

    const srv = base();
    srv.emergency = { killSwitch: false, suspendedTools: [], suspendedMcpServers: ["crm"] };
    expect(filterToolsForAgent(srv, tools, "CRM").every((t) => t.code === "MCP_SERVER_SUSPENDED")).toBe(true);

    expect(filterToolsForAgent({ ...base(), agent: { ...base().agent!, lifecycleState: "SUSPENDED" } }, tools)[0].code).toBe("AGENT_NOT_OPERATING");
    expect(filterToolsForAgent({ ...base(), contract: null }, tools)[0].code).toBe("NO_ACTIVE_CONTRACT");
    expect(filterToolsForAgent({ ...base(), agent: null }, tools)[0].code).toBe("UNKNOWN_AGENT");
  });
});

describe("decideRuntimeRequest — ACCESS-P0-12 policy targets and priority", () => {
  const always = { field: "request.action", op: "eq", value: "read" } as never;
  const block = (id: string, extra: object = {}) => ({ id, version: 1, name: id, action: "block" as const, rules: [{ id: `${id}-r`, condition: always }], ...extra });

  it("a targeted policy applies only when its target matches the request", () => {
    const onTool = block("tool-policy", { targets: [{ type: "TOOL", value: "export_all" }] });
    expect(decideRuntimeRequest(facts({ runtimePolicies: [onTool] })).decision).toBe("ALLOW");
    expect(stepOf(decideRuntimeRequest(facts({ runtimePolicies: [onTool] })), "runtime_policy")?.reason).toBe("No active runtime policy targets this request.");
    const onSnowflake = block("ds-policy", { targets: [{ type: "DATA_SOURCE", value: "Snowflake" }] });
    expect(decideRuntimeRequest(facts({ runtimePolicies: [onSnowflake] })).policyId).toBe("ds-policy");
  });

  it("among equally severe outcomes, the higher-priority policy decides, whatever the load order", () => {
    const low = block("low", { priority: 1 });
    const high = block("high", { priority: 50 });
    expect(decideRuntimeRequest(facts({ runtimePolicies: [low, high] })).policyId).toBe("high");
    expect(decideRuntimeRequest(facts({ runtimePolicies: [high, low] })).policyId).toBe("high");
  });

  it("priority never lets a milder outcome override a more severe one", () => {
    const flagHigh = { ...block("flag-high", { priority: 100 }), action: "restrict" as const };
    const blockLow = block("block-low", { priority: 0 });
    expect(decideRuntimeRequest(facts({ runtimePolicies: [flagHigh, blockLow] })).decision).toBe("DENY");
  });
});
