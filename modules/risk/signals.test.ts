// @vitest-environment node
import { describe, expect, it } from "vitest";
import { credentialHealth, destructiveCapability, suspiciousDelegation, unapprovedToolUse } from "./signals";
import type { AgentApiKey } from "@/lib/shared/types/foundation";
import type { AccessGrant } from "@/lib/shared/types/access-governance";
import type { AgentRelationship } from "@/lib/shared/types/agent-identity";
import type { RuntimeEvent } from "@/lib/shared/types/runtime";

const rel = (id: string, type: AgentRelationship["relationshipType"], relatedAgentId: string): AgentRelationship => ({
  id,
  tenantId: "t",
  agentId: "a",
  relatedAgentId,
  relationshipType: type,
  createdAt: "2026-09-01T00:00:00Z",
});

describe("suspiciousDelegation (RISK-P0-12)", () => {
  const related = new Map([
    ["ok", { name: "ReportBot", lifecycleState: "ACTIVE" }],
    ["gone", { name: "OldBot", lifecycleState: "RETIRED" }],
    ["shadow", { name: "NewBot", lifecycleState: "DISCOVERED" }],
  ]);

  it("flags credential sharing with any agent, and delegation to an ungoverned one", () => {
    const t = suspiciousDelegation("FinanceBot", [rel("r1", "shares_credential_with", "ok"), rel("r2", "delegates_to", "gone"), rel("r3", "orchestrates", "shadow")], related);
    expect(t?.category).toBe("suspicious_delegation");
    expect(t?.explanation).toBe("FinanceBot shares a credential with ReportBot; delegates to OldBot, which is retired; orchestrates NewBot, which is discovered.");
    expect(t?.evidence.map((e) => [e.evidenceType, e.referenceId])).toEqual([
      ["agent_relationship", "r1"],
      ["agent_relationship", "r2"],
      ["agent_relationship", "r3"],
    ]);
  });

  it("ignores delegation to an operating agent and plain dependencies", () => {
    expect(suspiciousDelegation("FinanceBot", [rel("r1", "delegates_to", "ok"), rel("r2", "depends_on", "gone")], related)).toBeNull();
  });

  it("treats a delegate it cannot see as ungoverned", () => {
    expect(suspiciousDelegation("FinanceBot", [rel("r1", "delegates_to", "missing")], related)?.explanation).toContain("delegates to an unknown agent");
  });
});

describe("unapprovedToolUse", () => {
  const events = [
    { id: "e2", tool: "delete_customer", eventTime: "2026-09-25T10:00:00Z" },
    { id: "e1", tool: "DELETE_CUSTOMER", eventTime: "2026-09-24T10:00:00Z" },
  ] as RuntimeEvent[];

  it("names the tools and cites the newest event using each", () => {
    const t = unapprovedToolUse("FinanceBot", ["delete_customer", "delete_customer", "export_all"], events, ["query_ledger"]);
    expect(t?.category).toBe("unapproved_tool_use");
    expect(t?.explanation).toBe("FinanceBot used delete_customer, export_all, which are not among its approved tools (query_ledger).");
    expect(t?.evidence).toEqual([{ evidenceType: "runtime_event", referenceId: "e2", summary: "delete_customer at 2026-09-25T10:00:00Z" }]);
  });

  it("raises nothing when every tool used was approved", () => {
    expect(unapprovedToolUse("FinanceBot", [], events, [])).toBeNull();
  });
});

describe("credentialHealth", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const key = (over: Partial<AgentApiKey>): AgentApiKey => ({
    id: "k",
    tenantId: "t",
    agentId: "a",
    name: "k",
    keyPrefix: "wa_ak_x",
    status: "active",
    createdBy: null,
    createdAt: "2026-09-20T00:00:00Z",
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    revokedReason: null,
    ...over,
  });

  it("is healthy for a recent key, or an old one that expires", () => {
    expect(credentialHealth([key({}), key({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-12-31T00:00:00Z" })], now)).toEqual({ unhealthy: false, reasons: [] });
  });

  it("flags rotation overdue and key sprawl; revoked keys do not count", () => {
    expect(credentialHealth([key({ createdAt: "2026-05-01T00:00:00Z" })], now).reasons).toEqual(["1 active key(s) older than 90 days with no expiry"]);
    expect(credentialHealth([key({}), key({}), key({}), key({})], now).reasons).toEqual(["4 active keys (more than 3)"]);
    expect(credentialHealth([key({ status: "revoked", createdAt: "2025-01-01T00:00:00Z" })], now).unhealthy).toBe(false);
  });
});

describe("destructiveCapability (CAN)", () => {
  const grant = (entitlementName: string, grantType: AccessGrant["grantType"] = "direct") => ({ entitlementName, grantType }) as AccessGrant;

  it("finds destructive entitlement names and declared-destructive MCP tool permissions", () => {
    const result = destructiveCapability(
      [grant("CustomerDB_READ"), grant("delete_records"), grant("PurgeBackups"), grant("post_journal_entry", "mcp_tool_permission"), grant("query_ledger", "mcp_tool_permission")],
      new Set(["post_journal_entry"]),
    );
    expect(result).toEqual({ present: true, names: ["PurgeBackups", "delete_records", "post_journal_entry"] });
  });

  it("a destructive MCP tool only counts when held as a tool permission", () => {
    expect(destructiveCapability([grant("post_journal_entry")], new Set(["post_journal_entry"])).present).toBe(false);
    expect(destructiveCapability([grant("CustomerDB_READ")], new Set()).present).toBe(false);
  });
});
