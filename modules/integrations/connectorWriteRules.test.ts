// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decideWrite, requestFingerprint, validateDeclaredCapabilities, validateWriteRequest } from "./connectorWriteRules";

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
