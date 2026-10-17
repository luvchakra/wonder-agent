import { describe, expect, it } from "vitest";
import { delegationCovers, delegationDecisionRefusal, parseOnBehalfOf, validateAgentDelegation } from "./agentDelegationRules";

const ME = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-10-17T10:00:00Z");

describe("ACCESS-P0-23 part 4: delegation to AI agents", () => {
  it("a person's delegation names the agent, actions, a reason and at most 180 days", () => {
    const v = validateAgentDelegation({ delegateAgentId: AGENT, actions: "read, report, read", applications: "Snowflake", days: 30, reason: "Month-end" }, ME, now);
    expect(v).toMatchObject({ delegator_kind: "user", delegator_user_id: ME, delegator_agent_id: null, actions: ["read", "report"], applications: ["Snowflake"], ends_at: "2026-11-16T10:00:00.000Z" });
    expect(validateAgentDelegation({ delegateAgentId: AGENT, actions: "", reason: "x" }, ME, now)).toMatchObject({ error: expect.stringMatching(/actions/) });
    expect(validateAgentDelegation({ delegateAgentId: AGENT, actions: "read", days: 181, reason: "x" }, ME, now)).toMatchObject({ error: expect.stringMatching(/days/) });
    expect(validateAgentDelegation({ delegateAgentId: AGENT, actions: "read" }, ME, now)).toMatchObject({ error: expect.stringMatching(/reason/) });
  });

  it("an agent's delegation is to another agent", () => {
    expect(validateAgentDelegation({ delegatorKind: "agent", delegatorAgentId: OTHER, delegateAgentId: AGENT, actions: ["read"], reason: "x" }, ME, now)).toMatchObject({ delegator_kind: "agent", delegator_user_id: null, delegator_agent_id: OTHER });
    expect(validateAgentDelegation({ delegatorKind: "agent", delegatorAgentId: AGENT, delegateAgentId: AGENT, actions: ["read"], reason: "x" }, ME, now)).toMatchObject({ error: expect.stringMatching(/itself/) });
  });

  it("an owner of the agent decides, never the asker; an access manager only when no other owner can", () => {
    const pending = { status: "pending", requestedBy: ME };
    expect(delegationDecisionRefusal(pending, { userId: ME, canManageAccess: true }, [ME])).toMatch(/someone else/);
    expect(delegationDecisionRefusal(pending, { userId: OTHER, canManageAccess: false }, [OTHER])).toBeNull();
    expect(delegationDecisionRefusal(pending, { userId: OTHER, canManageAccess: true }, [ME])).toBeNull();
    expect(delegationDecisionRefusal(pending, { userId: OTHER, canManageAccess: true }, [ME, AGENT])).toMatch(/owner/);
    expect(delegationDecisionRefusal(pending, { userId: OTHER, canManageAccess: false }, [])).toMatch(/owner/);
    expect(delegationDecisionRefusal({ status: "active", requestedBy: ME }, { userId: OTHER, canManageAccess: true }, [OTHER])).toMatch(/already/);
  });

  it("covers only the delegator's named actions and applications, while in force", () => {
    const d = [{ delegatorKind: "user" as const, delegatorId: ME, actions: ["Read"], applications: ["Snowflake"], startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }];
    expect(delegationCovers(d, { kind: "user", id: ME }, { action: "read", application: "snowflake" }, now)).toBe(true);
    expect(delegationCovers(d, { kind: "user", id: ME }, { action: "write", application: "Snowflake" }, now)).toBe(false);
    expect(delegationCovers(d, { kind: "user", id: ME }, { action: "read", application: "SAP" }, now)).toBe(false);
    expect(delegationCovers(d, { kind: "user", id: ME }, { action: "read" }, now)).toBe(false);
    expect(delegationCovers(d, { kind: "user", id: OTHER }, { action: "read", application: "Snowflake" }, now)).toBe(false);
    expect(delegationCovers(d, { kind: "agent", id: ME }, { action: "read", application: "Snowflake" }, now)).toBe(false);
    expect(delegationCovers(d, { kind: "user", id: ME }, { action: "read", application: "Snowflake" }, new Date("2026-11-02T00:00:00Z"))).toBe(false);
  });

  it("reads only an explicit onBehalfOf; a malformed one never matches", () => {
    expect(parseOnBehalfOf({})).toBeUndefined();
    expect(parseOnBehalfOf({ context: { userId: ME } })).toBeUndefined();
    expect(parseOnBehalfOf({ onBehalfOf: { kind: "user", id: ME } })).toEqual({ kind: "user", id: ME });
    expect(parseOnBehalfOf({ onBehalfOf: { type: "agent", id: AGENT } })).toEqual({ kind: "agent", id: AGENT });
    expect(parseOnBehalfOf({ onBehalfOf: "someone" })).toEqual({ kind: "user", id: "invalid" });
  });
});
