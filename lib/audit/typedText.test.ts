// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fingerprintText, matchesFingerprint, withTypedText } from "./typedText";

afterEach(() => vi.unstubAllEnvs());

describe("typed text in audit records (WID-H07)", () => {
  it("replaces each typed field with a fingerprint and its length; the words never reach the row", () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "k1");
    const out = withTypedText("t1", { reason: "leaked words", findingId: "f1" }, { reason: "On leave until May", note: null, skipped: undefined });
    expect(out.findingId).toBe("f1");
    expect(out.reason).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("On leave");
    expect(out.typedText).toEqual({ reason: { fingerprint: expect.stringMatching(/^hmac-sha256:v1:[0-9a-f]{64}$/), length: 18 }, note: null });
  });

  it("proves the text later, per organization, and under a retired key after rotation", () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "k1");
    const { fingerprint } = fingerprintText("t1", "approved for audit season");
    expect(matchesFingerprint("t1", "approved for audit season", fingerprint!)).toBe(true);
    expect(matchesFingerprint("t1", "approved for audit seasons", fingerprint!)).toBe(false);
    expect(matchesFingerprint("t2", "approved for audit season", fingerprint!)).toBe(false);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "k2");
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "k1");
    expect(matchesFingerprint("t1", "approved for audit season", fingerprint!)).toBe(true);
    // Without the key, a short reason cannot be confirmed by guessing.
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "other");
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "");
    expect(matchesFingerprint("t1", "approved for audit season", fingerprint!)).toBe(false);
  });

  it("stores no text even when no key is configured", () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    expect(withTypedText("t1", {}, { reason: "secret words" })).toEqual({ typedText: { reason: { fingerprint: null, length: 12 } } });
  });
});
