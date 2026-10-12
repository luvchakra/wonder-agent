// @vitest-environment node
import { describe, expect, it } from "vitest";
import { capabilitiesWithWrites, decideWrite, overWriteLimit, requestFingerprint, retryableWrite, systemKey, validateDeclaredCapabilities, validateWriteRequest, writeFailureKind, writesEnabled } from "./connectorWriteRules";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

const readOnly = { importIdentities: true, importAccounts: true, provision: false, deprovision: false };

describe("validateDeclaredCapabilities", () => {
  it("keeps what the connector supports and refuses writes it cannot perform", () => {
    expect(validateDeclaredCapabilities({ importIdentities: true, importAccounts: false }, readOnly)).toEqual({ importIdentities: true, importAccounts: false });
    expect(err(() => validateDeclaredCapabilities({ grantAccess: true }, readOnly))).toMatch(/cannot write/);
    expect(err(() => validateDeclaredCapabilities({ deleteAccount: true }, readOnly))).toMatch(/cannot write/);
    expect(validateDeclaredCapabilities({ grantAccess: false }, readOnly)).toEqual({ grantAccess: false });
    expect(validateDeclaredCapabilities({ grantAccess: true }, { ...readOnly, grantAccess: true })).toEqual({ grantAccess: true });
  });

  it("refuses unknown capabilities and non-boolean values", () => {
    expect(err(() => validateDeclaredCapabilities({ launchMissiles: true }, readOnly))).toMatch(/not a capability/);
    expect(err(() => validateDeclaredCapabilities({ importIdentities: "yes" }, readOnly))).toMatch(/true or false/);
    expect(err(() => validateDeclaredCapabilities([], readOnly))).toMatch(/object/);
  });
});

describe("validateWriteRequest", () => {
  const ok = { operation: "revoke_access", idempotencyKey: "req-2026-09-26:abc123", target: { accountId: "acc-1", entitlement: "CustomerDB" } };

  it("accepts a well-formed request", () => {
    expect(validateWriteRequest(ok)).toEqual({ ...ok, taskKey: null });
  });

  it("refuses unknown operations, weak or odd keys, empty targets and secrets in targets", () => {
    expect(err(() => validateWriteRequest({ ...ok, operation: "drop_table" }))).toMatch(/operation/);
    expect(err(() => validateWriteRequest({ ...ok, idempotencyKey: "short" }))).toMatch(/idempotencyKey/);
    expect(err(() => validateWriteRequest({ ...ok, idempotencyKey: "has spaces in it" }))).toMatch(/idempotencyKey/);
    expect(err(() => validateWriteRequest({ ...ok, target: {} }))).toMatch(/at least one/);
    expect(err(() => validateWriteRequest({ ...ok, target: { password: "hunter2" } }))).toMatch(/secrets/);
    expect(err(() => validateWriteRequest({ ...ok, target: { apiToken: "x" } }))).toMatch(/secrets/);
    expect(err(() => validateWriteRequest({ ...ok, target: { accountId: 42 } }))).toMatch(/text/);
  });
});

describe("requestFingerprint", () => {
  it("ignores field order but not values or operation", () => {
    expect(requestFingerprint("revoke_access", { a: "1", b: "2" })).toBe(requestFingerprint("revoke_access", { b: "2", a: "1" }));
    expect(requestFingerprint("revoke_access", { a: "1" })).not.toBe(requestFingerprint("grant_access", { a: "1" }));
    expect(requestFingerprint("revoke_access", { a: "1" })).not.toBe(requestFingerprint("revoke_access", { a: "2" }));
  });
});

describe("decideWrite", () => {
  it("blocks writes that are not declared, and anything on a disabled integration", () => {
    expect(decideWrite("revoke_access", readOnly, "connected")).toMatchObject({ run: false, status: "blocked", reason: expect.stringMatching(/read-only/) });
    expect(decideWrite("revoke_access", { revokeAccess: true }, "disabled")).toMatchObject({ run: false, reason: expect.stringMatching(/disabled/) });
    expect(decideWrite("revoke_access", { revokeAccess: true }, "connected")).toEqual({ run: true });
  });
});

describe("writes per connection (INTEGRATION-P0-13)", () => {
  const supported = { revokeAccess: true, disableAccount: true, deprovision: true };
  const reads = { importAccounts: true, importAccess: true };

  it("turning on declares exactly what the definition supports; off declares no write", () => {
    const on = capabilitiesWithWrites(reads, supported, true);
    expect(on).toMatchObject({ importAccounts: true, importAccess: true, revokeAccess: true, disableAccount: true, deprovision: true, grantAccess: false, createAccount: false, provision: false });
    expect(writesEnabled(on)).toBe(true);
    const off = capabilitiesWithWrites(on, supported, false);
    expect(off).toMatchObject({ importAccounts: true, revokeAccess: false, disableAccount: false, deprovision: false });
    expect(writesEnabled(off)).toBe(false);
    // Adding and creating (slice 2) come with provision.
    const adds = capabilitiesWithWrites(reads, { ...supported, grantAccess: true, createAccount: true, provision: true }, true);
    expect(adds).toMatchObject({ grantAccess: true, createAccount: true, provision: true, deprovision: true });
    expect(capabilitiesWithWrites(adds, { ...supported, grantAccess: true, createAccount: true, provision: true }, false)).toMatchObject({ grantAccess: false, createAccount: false, provision: false });
    // Never more than supported, whatever was stored before.
    expect(capabilitiesWithWrites({ ...reads, grantAccess: true }, { revokeAccess: true }, true)).toMatchObject({ grantAccess: false, revokeAccess: true, disableAccount: false });
  });

  it("a declared write runs only while its capability is declared", () => {
    expect(decideWrite("revoke_access", capabilitiesWithWrites(reads, supported, true), "connected")).toEqual({ run: true });
    expect(decideWrite("revoke_access", capabilitiesWithWrites(reads, supported, false), "connected").run).toBe(false);
    expect(decideWrite("revoke_access", capabilitiesWithWrites(reads, supported, true), "disabled").run).toBe(false);
  });

  it("WID-H02: tells a refused write from one the system may have applied", () => {
    expect(writeFailureKind({ status: 429 })).toBe("not_applied");
    expect(writeFailureKind({ status: 503 })).toBe("unclear");
    expect(writeFailureKind({ status: 500 })).toBe("unclear");
    expect(writeFailureKind({ status: 408 })).toBe("unclear");
    expect(writeFailureKind({ status: 404 })).toBe("refused");
    expect(writeFailureKind({ status: 403 })).toBe("refused");
    expect(writeFailureKind({ code: "ECONNREFUSED" })).toBe("not_applied");
    expect(writeFailureKind({ code: "ENOTFOUND" })).toBe("not_applied");
    expect(writeFailureKind({ code: "ECONNRESET" })).toBe("unclear");
    expect(writeFailureKind({ message: "The request to x timed out after 20 s" })).toBe("unclear");
    expect(writeFailureKind({ message: "Write did not return JSON" })).toBe("unclear");
    expect(writeFailureKind({ network: true, message: "fetch failed" })).toBe("unclear");
    expect(writeFailureKind({ blocked: true, status: 503 })).toBe("refused");
    expect(writeFailureKind({ message: "This connector cannot create account" })).toBe("refused");
  });

  it("WID-H02: sends an unclear write again only when it is repeatable", () => {
    expect(retryableWrite("not_applied", false)).toBe(true);
    expect(retryableWrite("unclear", true)).toBe(true);
    expect(retryableWrite("unclear", false)).toBe(false);
    expect(retryableWrite("refused", true)).toBe(false);
  });

  it("WID-H02: one system key per task and change, the attempt key without a task", () => {
    const fp = requestFingerprint("disable_account", { account: "u1" });
    const first = systemKey({ idempotencyKey: "fulfil:t1:1", taskKey: "fulfil:t1" }, fp);
    expect(systemKey({ idempotencyKey: "fulfil:t1:2", taskKey: "fulfil:t1" }, fp)).toBe(first);
    expect(systemKey({ idempotencyKey: "fulfil:t1:2", taskKey: "fulfil:t1" }, requestFingerprint("disable_account", { account: "u2" }))).not.toBe(first);
    expect(systemKey({ idempotencyKey: "attempt-key-1", taskKey: null }, fp)).toBe("attempt-key-1");
    expect(first).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
  });

  it("WID-H02: validates the task key", () => {
    const base = { operation: "disable_account", idempotencyKey: "fulfil:t1:1", target: { account: "u1" } };
    expect(validateWriteRequest(base).taskKey).toBeNull();
    expect(validateWriteRequest({ ...base, taskKey: "fulfil:t1" }).taskKey).toBe("fulfil:t1");
    expect(() => validateWriteRequest({ ...base, taskKey: "bad key!" })).toThrow(/taskKey/);
  });
});

describe("mass-change guard (QA-P0-26)", () => {
  it("allows changes up to the hourly limit and refuses the next with the reason", () => {
    expect(overWriteLimit(0, 100)).toEqual({ run: true });
    expect(overWriteLimit(99, 100)).toEqual({ run: true });
    const refused = overWriteLimit(100, 100);
    expect(refused).toMatchObject({ run: false, status: "blocked" });
    expect(refused.run === false && refused.reason).toMatch(/Mass-change guard: .* 100 changes in the last hour \(limit 100\)/);
    expect(overWriteLimit(5, 1).run).toBe(false);
  });
});
