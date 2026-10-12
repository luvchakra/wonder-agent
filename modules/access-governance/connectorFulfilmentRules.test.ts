import { describe, expect, it } from "vitest";
import { attemptKey, connectorOperation, connectorTarget, retryDelayMs, runIsLost, shouldRetry, MAX_ATTEMPTS_PER_RUN, MAX_ATTEMPTS_TOTAL } from "./connectorFulfilmentRules";

describe("connector fulfilment rules (INTEGRATION-P0-13)", () => {
  it("does removals and disabling only (D3: reversible first)", () => {
    expect(connectorOperation("remove")).toBe("revoke_access");
    expect(connectorOperation("disable_account")).toBe("disable_account");
    expect(connectorOperation("grant")).toBeNull();
    expect(connectorOperation("create_account")).toBeNull();
  });

  it("targets the account's own connection, and a removal only an entitlement from that same connection", () => {
    const account = { externalRef: "u1", integrationId: "conn-a" };
    expect(connectorTarget("disable_account", account, null)).toEqual({ integrationId: "conn-a", target: { account: "u1" } });
    expect(connectorTarget("revoke_access", account, { externalRef: "g1", integrationId: "conn-a" })).toEqual({ integrationId: "conn-a", target: { account: "u1", entitlement: "g1" } });
    expect(connectorTarget("revoke_access", account, { externalRef: "g1", integrationId: "conn-b" })).toBeNull();
    expect(connectorTarget("revoke_access", account, { externalRef: null, integrationId: "conn-a" })).toBeNull();
    expect(connectorTarget("disable_account", { externalRef: "u1", integrationId: null }, null)).toBeNull();
    expect(connectorTarget("disable_account", { externalRef: null, integrationId: "conn-a" }, null)).toBeNull();
    expect(connectorTarget("disable_account", null, null)).toBeNull();
  });

  it("retries a retryable failure twice in a run, and never past the total cap", () => {
    const failed = { status: "failed", retryable: true };
    expect(shouldRetry(failed, 1, 1)).toBe(true);
    expect(shouldRetry(failed, MAX_ATTEMPTS_PER_RUN, 3)).toBe(false);
    expect(shouldRetry(failed, 1, MAX_ATTEMPTS_TOTAL)).toBe(false);
    expect(shouldRetry({ status: "failed", retryable: false }, 1, 1)).toBe(false);
    expect(shouldRetry({ status: "blocked" }, 1, 1)).toBe(false);
    expect(shouldRetry({ status: "succeeded" }, 1, 1)).toBe(false);
    expect([retryDelayMs(1), retryDelayMs(2)]).toEqual([2000, 8000]);
  });

  it("a run silent for over 15 minutes is lost; each attempt has its own key", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(runIsLost("2026-10-12T09:44:00Z", now)).toBe(true);
    expect(runIsLost("2026-10-12T09:50:00Z", now)).toBe(false);
    expect(runIsLost(null, now)).toBe(false);
    expect(attemptKey("t1", 2)).toBe("fulfil:t1:2");
    expect(attemptKey("8a3b1f2c-0000-4000-8000-000000000001", 20)).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
  });
});
