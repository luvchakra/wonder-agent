// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn(async () => undefined);
const recently = vi.fn(async () => false);
vi.mock("@/modules/operations/service", () => ({
  notify: (...a: unknown[]) => notify(...(a as [])),
  wasRecentlyNotified: (...a: unknown[]) => recently(...(a as [])),
}));
const name = vi.fn(async () => "FinanceBot");
vi.mock("@/modules/agent-identity/service", () => ({ getAgentDisplayName: (...a: unknown[]) => name(...(a as [])) }));

import { THROTTLE_MINUTES, notificationForDecision, notifyForDecision } from "./decisionNotifications";

const base = { decisionId: "d1", requestId: "req-1", code: "APPLICATION_NOT_APPROVED", reason: "Snowflake CustomerDB is not approved." };
const request = { action: "READ", application: "Snowflake", resource: "CustomerDB", tool: undefined };

beforeEach(() => {
  notify.mockClear();
  recently.mockReset();
  recently.mockResolvedValue(false);
  name.mockClear();
});

describe("notificationForDecision (OPERATIONS-P0-08)", () => {
  it("an enforced DENY is a runtime alert about the agent", () => {
    const e = notificationForDecision("t", "a", "FinanceBot", { ...base, enforced: true, effectiveDecision: "DENY" }, request);
    expect(e).toMatchObject({ tenantId: "t", type: "runtime_alert", referenceType: "agent", referenceId: "a" });
    expect(e?.title).toBe("Runtime Gateway blocked FinanceBot: READ on application Snowflake, resource CustomerDB");
    expect(e?.body).toContain("APPLICATION_NOT_APPROVED");
    expect(e?.body).toContain("req-1");
  });

  it("an enforced REQUIRE_APPROVAL asks for approval", () => {
    const e = notificationForDecision("t", "a", "FinanceBot", { ...base, enforced: true, effectiveDecision: "REQUIRE_APPROVAL" }, request);
    expect(e?.type).toBe("approval_required");
    expect(e?.title).toMatch(/^FinanceBot is waiting for approval/);
  });

  it("observe-only decisions and allowed requests raise nothing", () => {
    // In OBSERVE_ONLY the agent was told to proceed: nothing was blocked.
    expect(notificationForDecision("t", "a", "x", { ...base, enforced: false, effectiveDecision: "ALLOW" }, request)).toBeNull();
    expect(notificationForDecision("t", "a", "x", { ...base, enforced: true, effectiveDecision: "ALLOW" }, request)).toBeNull();
    expect(notificationForDecision("t", "a", "x", { ...base, enforced: true, effectiveDecision: "ALLOW_WITH_RESTRICTIONS" }, request)).toBeNull();
  });
});

describe("notifyForDecision", () => {
  it("notifies once per agent and type within the throttle window", async () => {
    await notifyForDecision("t", "a", { ...base, enforced: true, effectiveDecision: "DENY" }, request);
    expect(recently).toHaveBeenCalledWith("t", "runtime_alert", "a", THROTTLE_MINUTES / (24 * 60));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("FinanceBot") }));

    recently.mockResolvedValue(true);
    await notifyForDecision("t", "a", { ...base, enforced: true, effectiveDecision: "DENY" }, request);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does no lookups for a decision that raises nothing", async () => {
    await notifyForDecision("t", "a", { ...base, enforced: false, effectiveDecision: "ALLOW" }, request);
    expect(recently).not.toHaveBeenCalled();
    expect(name).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("never throws: a failed lookup is logged, and the decision already returned stands", async () => {
    recently.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyForDecision("t", "a", { ...base, enforced: true, effectiveDecision: "DENY" }, request)).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("falls back to a generic name when the agent is not found in this tenant", async () => {
    name.mockResolvedValueOnce(null as unknown as string);
    await notifyForDecision("t", "a", { ...base, enforced: true, effectiveDecision: "DENY" }, request);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/^Runtime Gateway blocked An agent/) }));
  });
});
