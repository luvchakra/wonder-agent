// @vitest-environment node
import { describe, expect, it } from "vitest";
import { capabilitiesWithWrites, decideWrite, requestFingerprint, retryableWriteFailure, validateDeclaredCapabilities, validateWriteRequest, writesEnabled } from "./connectorWriteRules";

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
    expect(validateWriteRequest(ok)).toEqual(ok);
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

  it("retries only network failures, rate limits and server errors", () => {
    expect(retryableWriteFailure(undefined, "network")).toBe(true);
    expect(retryableWriteFailure(429, "http")).toBe(true);
    expect(retryableWriteFailure(503, "http")).toBe(true);
    expect(retryableWriteFailure(404, "http")).toBe(false);
    expect(retryableWriteFailure(403, "http")).toBe(false);
    expect(retryableWriteFailure(undefined, "other")).toBe(false);
  });
});
