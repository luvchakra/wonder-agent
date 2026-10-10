// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ABSOLUTE_SESSION_MAX_MS, IDLE_TIMEOUT_MS, checkSessionExpiry, sessionLimitsFrom } from "./sessionSecurity";

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

describe("isAuthServiceUnavailable", () => {
  it("is true for a network failure or a server error, false for a rejected session", async () => {
    const { isAuthServiceUnavailable } = await import("./sessionSecurity");
    expect(isAuthServiceUnavailable({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
    expect(isAuthServiceUnavailable({ name: "AuthApiError", status: 503 })).toBe(true);
    expect(isAuthServiceUnavailable({ name: "AuthApiError", status: 403 })).toBe(false);
    expect(isAuthServiceUnavailable({ name: "AuthSessionMissingError", status: 400 })).toBe(false);
    expect(isAuthServiceUnavailable(null)).toBe(false);
  });
});

describe("an organization's session limits (Global Configuration)", () => {
  const now = 1_800_000_000_000;
  it("expire a session sooner when the organization says so", () => {
    const limits = sessionLimitsFrom({ idleMinutes: 10, maxHours: 2 });
    expect(checkSessionExpiry(now - 3_600_000, now - 11 * 60_000, now, limits)).toEqual({ expired: true, reason: "idle" });
    expect(checkSessionExpiry(now - 3 * 3_600_000, now - 60_000, now, limits)).toEqual({ expired: true, reason: "absolute" });
    expect(checkSessionExpiry(now - 3_600_000, now - 9 * 60_000, now, limits)).toEqual({ expired: false });
  });

  it("never lengthen a session past the global limits, whatever they are given", () => {
    expect(sessionLimitsFrom({ idleMinutes: 600, maxHours: 99 })).toEqual({ idleMs: IDLE_TIMEOUT_MS, absoluteMs: ABSOLUTE_SESSION_MAX_MS });
    expect(sessionLimitsFrom(null)).toEqual({ idleMs: IDLE_TIMEOUT_MS, absoluteMs: ABSOLUTE_SESSION_MAX_MS });
    expect(sessionLimitsFrom({ idleMinutes: "x", maxHours: -1 })).toEqual({ idleMs: IDLE_TIMEOUT_MS, absoluteMs: ABSOLUTE_SESSION_MAX_MS });
    // Even limits passed straight in cannot exceed the ceiling.
    expect(checkSessionExpiry(null, now - IDLE_TIMEOUT_MS - 1, now, { idleMs: 10 * IDLE_TIMEOUT_MS, absoluteMs: 10 * ABSOLUTE_SESSION_MAX_MS })).toEqual({ expired: true, reason: "idle" });
  });
});
