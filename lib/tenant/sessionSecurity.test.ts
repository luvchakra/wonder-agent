// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ABSOLUTE_SESSION_MAX_MS, IDLE_TIMEOUT_MS, checkSessionExpiry } from "./sessionSecurity";

describe("checkSessionExpiry — FOUNDATION-P0-09", () => {
  const now = 1_000_000_000_000;

  it("is not expired for a fresh session", () => {
    expect(checkSessionExpiry(now, now, now)).toEqual({ expired: false });
  });

  it("expires on idle timeout even within the absolute window", () => {
    const lastSeen = now - IDLE_TIMEOUT_MS - 1;
    expect(checkSessionExpiry(now - 1000, lastSeen, now)).toEqual({ expired: true, reason: "idle" });
  });

  it("expires on absolute timeout even with continuous activity", () => {
    const startedAt = now - ABSOLUTE_SESSION_MAX_MS - 1;
    expect(checkSessionExpiry(startedAt, now, now)).toEqual({ expired: true, reason: "absolute" });
  });

  it("treats missing cookie values as not-yet-expired (pre-existing session, not yet stamped)", () => {
    expect(checkSessionExpiry(null, null, now)).toEqual({ expired: false });
  });

  it("prioritizes absolute expiry when both thresholds are crossed", () => {
    const startedAt = now - ABSOLUTE_SESSION_MAX_MS - 1;
    const lastSeen = now - IDLE_TIMEOUT_MS - 1;
    expect(checkSessionExpiry(startedAt, lastSeen, now)).toEqual({ expired: true, reason: "absolute" });
  });
});
