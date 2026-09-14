// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertJsonSizeWithinLimit,
  assertNonEmptyString,
  assertOneOf,
  assertPlainObject,
  assertUuid,
  sanitizePlainText,
} from "./validate";
import { ApiError } from "@/lib/shared/types/foundation";

describe("assertNonEmptyString — FOUNDATION-P0-11", () => {
  it("returns the trimmed string when valid", () => {
    expect(assertNonEmptyString("  hello  ", "name")).toBe("hello");
  });
  it("rejects an empty/whitespace-only string", () => {
    expect(() => assertNonEmptyString("   ", "name")).toThrow(ApiError);
  });
  it("rejects a non-string", () => {
    expect(() => assertNonEmptyString(42, "name")).toThrow(ApiError);
  });
  it("rejects a string longer than maxLength", () => {
    expect(() => assertNonEmptyString("abcdef", "name", { maxLength: 3 })).toThrow(ApiError);
  });
});

describe("assertUuid", () => {
  it("accepts a valid UUID", () => {
    expect(assertUuid("11111111-2222-3333-4444-555555555555", "id")).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });
  it("rejects a non-UUID string", () => {
    expect(() => assertUuid("not-a-uuid", "id")).toThrow(ApiError);
  });
});

describe("assertOneOf", () => {
  it("accepts an allowed value", () => {
    expect(assertOneOf("saml", ["saml", "oidc"] as const, "protocol")).toBe("saml");
  });
  it("rejects a value not in the allowed set", () => {
    expect(() => assertOneOf("ldap", ["saml", "oidc"] as const, "protocol")).toThrow(ApiError);
  });
});

describe("assertPlainObject", () => {
  it("accepts a plain object", () => {
    expect(assertPlainObject({ a: 1 }, "metadata")).toEqual({ a: 1 });
  });
  it("rejects an array", () => {
    expect(() => assertPlainObject([1, 2], "metadata")).toThrow(ApiError);
  });
  it("rejects null", () => {
    expect(() => assertPlainObject(null, "metadata")).toThrow(ApiError);
  });
});

describe("assertJsonSizeWithinLimit", () => {
  it("passes for a small payload", () => {
    expect(() => assertJsonSizeWithinLimit({ a: 1 }, "metadata", 1000)).not.toThrow();
  });
  it("rejects a payload over the byte limit", () => {
    expect(() => assertJsonSizeWithinLimit({ a: "x".repeat(1000) }, "metadata", 100)).toThrow(ApiError);
  });
});

describe("sanitizePlainText", () => {
  it("strips control characters but keeps newlines/tabs", () => {
    expect(sanitizePlainText("hello\x00world\n\ttab")).toBe("helloworld\n\ttab");
  });
  it("caps length", () => {
    expect(sanitizePlainText("abcdef", 3)).toBe("abc");
  });
});
