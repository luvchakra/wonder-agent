// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const headersMap = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => headersMap.get(k) ?? null }),
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
}));

const checkAndRecordAttemptMock = vi.fn();
vi.mock("@/lib/security/rateLimiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rateLimiter")>();
  return { ...actual, checkAndRecordAttempt: (...args: unknown[]) => checkAndRecordAttemptMock(...args) };
});

const resetPasswordForEmailMock = vi.fn();
const updateUserMock = vi.fn();
const getUserMock = vi.fn();
vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServer: async () => ({
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmailMock(...args),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  }),
  supabaseServiceRole: vi.fn(),
}));

const { requestPasswordResetAction, updatePasswordAction } = await import("./auth");

describe("requestPasswordResetAction", () => {
  beforeEach(() => {
    headersMap.clear();
    checkAndRecordAttemptMock.mockReset().mockResolvedValue({ allowed: true });
    resetPasswordForEmailMock.mockReset().mockResolvedValue({ error: null });
  });

  it("is rate-limited before Supabase is ever called", async () => {
    checkAndRecordAttemptMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3600 });
    const result = await requestPasswordResetAction("user@example.com");
    expect(result).toEqual({ ok: false, error: "Too many password reset requests. Please try again later." });
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it("calls resetPasswordForEmail with a redirectTo carrying next=/update-password through the shared callback", async () => {
    headersMap.set("host", "example.com");
    headersMap.set("x-forwarded-proto", "https");
    const result = await requestPasswordResetAction("user@example.com");
    expect(result).toEqual({ ok: true });
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "https://example.com/auth/callback?next=/update-password",
    });
  });

  it("falls back to http/localhost:3100 when no forwarding headers are present (local dev)", async () => {
    await requestPasswordResetAction("user@example.com");
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "http://localhost:3100/auth/callback?next=/update-password",
    });
  });

  it("surfaces a real Supabase error rather than swallowing it", async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({ error: { message: "email rate limit exceeded" } });
    const result = await requestPasswordResetAction("user@example.com");
    expect(result).toEqual({ ok: false, error: "email rate limit exceeded" });
  });
});

describe("updatePasswordAction", () => {
  beforeEach(() => {
    updateUserMock.mockReset();
    getUserMock.mockReset();
  });

  it("refuses when there is no active (recovery) session", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });
    const result = await updatePasswordAction("a-new-password-123");
    expect(result.ok).toBe(false);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("updates the password when a session is present", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    updateUserMock.mockResolvedValueOnce({ error: null });
    const result = await updatePasswordAction("a-new-password-123");
    expect(result).toEqual({ ok: true });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "a-new-password-123" });
  });

  it("surfaces a Supabase validation error (e.g. a too-weak password)", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    updateUserMock.mockResolvedValueOnce({ error: { message: "Password should be at least 6 characters" } });
    const result = await updatePasswordAction("short");
    expect(result).toEqual({ ok: false, error: "Password should be at least 6 characters" });
  });
});
