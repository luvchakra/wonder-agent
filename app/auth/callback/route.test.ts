// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isSafeRelativeNextPath, signInFailureReason } from "./route";

describe("isSafeRelativeNextPath — open-redirect guard for ?next=", () => {
  it("accepts a bare relative path", () => {
    expect(isSafeRelativeNextPath("/update-password")).toBe(true);
  });

  it("accepts a relative path with a query string", () => {
    expect(isSafeRelativeNextPath("/agents?tab=active")).toBe(true);
  });

  it("rejects null/missing", () => {
    expect(isSafeRelativeNextPath(null)).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isSafeRelativeNextPath("")).toBe(false);
  });

  it("rejects a protocol-relative URL (the classic open-redirect vector)", () => {
    expect(isSafeRelativeNextPath("//evil.example.com")).toBe(false);
    expect(isSafeRelativeNextPath("//evil.example.com/update-password")).toBe(false);
  });

  it("rejects an absolute URL with a scheme", () => {
    expect(isSafeRelativeNextPath("https://evil.example.com")).toBe(false);
    expect(isSafeRelativeNextPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects a path that doesn't start with /", () => {
    expect(isSafeRelativeNextPath("update-password")).toBe(false);
  });
});

describe("signInFailureReason — what /sign-in is told after a failed OAuth/SSO round trip", () => {
  it("reports a cancelled consent screen as cancelled", () => {
    expect(signInFailureReason("access_denied", false)).toBe("oauth_cancelled");
  });

  it("reports any other provider error or a failed code exchange as failed", () => {
    expect(signInFailureReason("server_error", false)).toBe("oauth_failed");
    expect(signInFailureReason(null, true)).toBe("oauth_failed");
  });

  it("adds nothing for a plain visit with no error and no code", () => {
    expect(signInFailureReason(null, false)).toBeNull();
  });

  it("only ever returns fixed codes, never the provider's text", () => {
    expect(signInFailureReason("<script>alert(1)</script>", false)).toBe("oauth_failed");
  });
});
