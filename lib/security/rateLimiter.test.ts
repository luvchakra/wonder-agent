// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const deleteCalls: { bucket: string; subject: string }[] = [];
const insertCalls: { bucket: string; subject: string }[] = [];
let mockCount = 0;

function ratelimitTable() {
  return {
    delete: () => ({
      eq: (col1: string, val1: string) => ({
        eq: (col2: string, val2: string) => ({
          lt: async () => {
            if (col1 === "bucket" && col2 === "subject") deleteCalls.push({ bucket: val1, subject: val2 });
            return { error: null };
          },
        }),
      }),
    }),
    select: () => ({
      eq: () => ({
        eq: () => ({
          gte: async () => ({ count: mockCount, error: null }),
        }),
      }),
    }),
    insert: async (row: { bucket: string; subject: string }) => {
      insertCalls.push(row);
      return { error: null };
    },
  };
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({ from: () => ratelimitTable() }),
}));

const { checkAndRecordAttempt, isDistinguishingClientIp } = await import("./rateLimiter");

describe("checkAndRecordAttempt — FOUNDATION-P0-05.3", () => {
  beforeEach(() => {
    deleteCalls.length = 0;
    insertCalls.length = 0;
    mockCount = 0;
  });

  it("allows an attempt when the window count is under the limit", async () => {
    mockCount = 3;
    const result = await checkAndRecordAttempt("signin:email", "user@example.com", { maxAttempts: 10, windowSeconds: 300 });
    expect(result.allowed).toBe(true);
    expect(insertCalls).toEqual([{ bucket: "signin:email", subject: "user@example.com" }]);
  });

  it("blocks once the window count reaches maxAttempts, and does not record another attempt", async () => {
    mockCount = 10;
    const result = await checkAndRecordAttempt("signin:email", "user@example.com", { maxAttempts: 10, windowSeconds: 300 });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(300);
    expect(insertCalls).toEqual([]);
  });

  it("blocks once the window count is over maxAttempts", async () => {
    mockCount = 25;
    const result = await checkAndRecordAttempt("signup:ip", "203.0.113.4", { maxAttempts: 5, windowSeconds: 3600 });
    expect(result.allowed).toBe(false);
  });

  it("prunes attempts outside the window before counting", async () => {
    await checkAndRecordAttempt("signin:ip", "203.0.113.4", { maxAttempts: 10, windowSeconds: 300 });
    expect(deleteCalls).toEqual([{ bucket: "signin:ip", subject: "203.0.113.4" }]);
  });
});

describe("isDistinguishingClientIp — regression for the shared-bucket lockout", () => {
  // Observed for real in auth_rate_limit_attempts on this project (2026-09-17):
  // the signin:ip bucket for subject "127.0.0.1" reached 10/10 within one
  // 5-minute window from ordinary traffic, which would block every visitor
  // behind that address — including ones who never attempted 10 sign-ins
  // themselves — until the window rolled over. See app/actions/auth.ts.
  it("rejects the no-header fallback", () => {
    expect(isDistinguishingClientIp("unknown")).toBe(false);
  });

  it("rejects loopback/unspecified addresses that a real visitor could never present as", () => {
    expect(isDistinguishingClientIp("127.0.0.1")).toBe(false);
    expect(isDistinguishingClientIp("::1")).toBe(false);
    expect(isDistinguishingClientIp("::ffff:127.0.0.1")).toBe(false);
    expect(isDistinguishingClientIp("0.0.0.0")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isDistinguishingClientIp("")).toBe(false);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isDistinguishingClientIp("  UNKNOWN  ")).toBe(false);
    expect(isDistinguishingClientIp("  ::1  ")).toBe(false);
  });

  it("accepts a real, distinguishing public IP", () => {
    expect(isDistinguishingClientIp("203.0.113.4")).toBe(true);
    expect(isDistinguishingClientIp("2001:db8::1")).toBe(true);
  });
});
