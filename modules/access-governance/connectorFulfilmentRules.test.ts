import { describe, expect, it } from "vitest";
import { accountsToDisableOnLeave, attemptKey, connectorOperation, connectorTarget, newAccountTarget, retryDelayMs, retryWaitsForRead, runIsLost, shouldRetry, taskKey, uncertainReason, MAX_ATTEMPTS_PER_RUN, MAX_ATTEMPTS_TOTAL } from "./connectorFulfilmentRules";

describe("connector fulfilment rules (INTEGRATION-P0-13)", () => {
  it("maps each task kind to its write (D3)", () => {
    expect(connectorOperation("remove")).toBe("revoke_access");
    expect(connectorOperation("disable_account")).toBe("disable_account");
    expect(connectorOperation("grant")).toBe("grant_access");
    expect(connectorOperation("create_account")).toBe("create_account");
  });

  it("adds access only to a real account, with an entitlement from its own connection", () => {
    const account = { externalRef: "u1", integrationId: "conn-a" };
    expect(connectorTarget("grant_access", account, { externalRef: "g1", integrationId: "conn-a" })).toEqual({ integrationId: "conn-a", target: { account: "u1", entitlement: "g1" } });
    expect(connectorTarget("grant_access", account, { externalRef: "g1", integrationId: "conn-b" })).toBeNull();
    expect(connectorTarget("grant_access", { ...account, pending: true }, { externalRef: "g1", integrationId: "conn-a" })).toBeNull();
    expect(connectorTarget("grant_access", account, null)).toBeNull();
  });

  it("names a new account after its subject, through the application's connection", () => {
    expect(newAccountTarget({ email: " dee@acme.example ", username: "dee", displayName: "Dee" }, "conn-a")).toEqual({ integrationId: "conn-a", target: { email: "dee@acme.example", username: "dee", displayName: "Dee" } });
    expect(newAccountTarget({ email: null, username: "bot-7", displayName: null }, "conn-a")).toEqual({ integrationId: "conn-a", target: { username: "bot-7" } });
    // A display name alone is not unique; no connection, no subject: a person's task.
    expect(newAccountTarget({ email: null, username: "  ", displayName: "Dee" }, "conn-a")).toBeNull();
    expect(newAccountTarget({ email: "dee@acme.example", username: null, displayName: null }, null)).toBeNull();
    expect(newAccountTarget(null, "conn-a")).toBeNull();
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

describe("WID-H02: one task, unclear outcomes", () => {
  it("names the task once for the system, and each attempt for WonderID's record", () => {
    expect(taskKey("t-0001")).toBe("fulfil:t-0001");
    expect(attemptKey("t-0001", 1).startsWith(taskKey("t-0001") + ":")).toBe(true);
    expect(taskKey("8a3b1f2c-0000-4000-8000-000000000001")).toMatch(/^[A-Za-z0-9._:-]{8,180}$/);
  });

  it("a retry waits for a read of the system only after an unclear outcome", () => {
    expect(retryWaitsForRead(null, false)).toBe(false);
    expect(retryWaitsForRead("2026-10-12T10:00:00Z", false)).toBe(true);
    expect(retryWaitsForRead("2026-10-12T10:00:00Z", true)).toBe(false);
  });

  it("tells the owner the change may be there and that the task may close by itself", () => {
    const reason = uncertainReason("Write failed: HTTP 503");
    expect(reason).toMatch(/may have made this change/);
    expect(reason).toContain("HTTP 503");
    expect(reason).toMatch(/closes by itself/);
    expect(uncertainReason(null)).toContain("no answer");
  });
});

describe("accountsToDisableOnLeave (WID-C02)", () => {
  const acct = (over: Partial<Parameters<typeof accountsToDisableOnLeave>[0][number]>) => ({ id: "a", applicationId: "app", status: "active", externalRef: "u-1", integrationId: "c1", ...over });
  it("takes real, live accounts that came from a connection", () => {
    expect(accountsToDisableOnLeave([acct({}), acct({ id: "b", status: null })]).map((a) => a.id)).toEqual(["a", "b"]);
  });
  it("skips accounts already disabled, placeholders, and accounts no connection can name", () => {
    expect(accountsToDisableOnLeave([acct({ status: "disabled" }), acct({ status: "pending" }), acct({ externalRef: null }), acct({ integrationId: null })])).toEqual([]);
  });
});
