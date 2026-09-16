// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockGetResendApiKey = vi.fn();
const mockGetResendFromEmail = vi.fn();
vi.mock("@/lib/db/env", () => ({
  getResendApiKey: () => mockGetResendApiKey(),
  getResendFromEmail: () => mockGetResendFromEmail(),
}));

let memberships: { user_id: string }[] = [];
let users: { id: string; email: string }[] = [];
let preferences: { user_id: string; email_enabled: boolean }[] = [];

function makeFrom(table: string) {
  if (table === "tenant_memberships") {
    return {
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: memberships, error: null }),
        }),
      }),
    };
  }
  if (table === "users") {
    return {
      select: () => ({
        in: async () => ({ data: users, error: null }),
      }),
    };
  }
  if (table === "notification_preferences") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: async () => ({ data: preferences, error: null }),
          }),
        }),
      }),
    };
  }
  throw new Error(`Unexpected table ${table}`);
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({ from: (table: string) => makeFrom(table) }),
}));

import { sendNotificationEmail } from "./email";

describe("sendNotificationEmail — OPERATIONS-P0-02.1 (Resend)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    memberships = [];
    users = [];
    preferences = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("is a silent no-op when Resend is not configured (no key/from email)", async () => {
    mockGetResendApiKey.mockReturnValue(null);
    mockGetResendFromEmail.mockReturnValue(null);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendNotificationEmail({
      tenantId: "tenant-1",
      userId: "user-1",
      type: "critical_finding",
      title: "Critical finding",
      body: "Something happened",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends to the targeted user when userId is set", async () => {
    mockGetResendApiKey.mockReturnValue("re_test_key");
    mockGetResendFromEmail.mockReturnValue("notifications@wonderagent.example");
    users = [{ id: "user-1", email: "user1@example.com" }];
    preferences = [];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendNotificationEmail({
      tenantId: "tenant-1",
      userId: "user-1",
      type: "certification_overdue",
      title: "Overdue",
      body: "Body text",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      from: "notifications@wonderagent.example",
      to: "user1@example.com",
      subject: "Overdue",
      text: "Body text",
    });
  });

  it("broadcasts to every active tenant member when userId is unset", async () => {
    mockGetResendApiKey.mockReturnValue("re_test_key");
    mockGetResendFromEmail.mockReturnValue("notifications@wonderagent.example");
    memberships = [{ user_id: "user-1" }, { user_id: "user-2" }];
    users = [
      { id: "user-1", email: "user1@example.com" },
      { id: "user-2", email: "user2@example.com" },
    ];
    preferences = [];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendNotificationEmail({
      tenantId: "tenant-1",
      type: "rogue_agent",
      title: "Rogue agent",
      body: "Body text",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const recipients = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).to).sort();
    expect(recipients).toEqual(["user1@example.com", "user2@example.com"]);
  });

  it("excludes a recipient whose preference row has email_enabled: false", async () => {
    mockGetResendApiKey.mockReturnValue("re_test_key");
    mockGetResendFromEmail.mockReturnValue("notifications@wonderagent.example");
    memberships = [{ user_id: "user-1" }, { user_id: "user-2" }];
    users = [
      { id: "user-1", email: "user1@example.com" },
      { id: "user-2", email: "user2@example.com" },
    ];
    preferences = [{ user_id: "user-2", email_enabled: false }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendNotificationEmail({
      tenantId: "tenant-1",
      type: "integration_failure",
      title: "Sync failed",
      body: "Body text",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toBe("user1@example.com");
  });

  it("never throws when Resend returns a non-OK response", async () => {
    mockGetResendApiKey.mockReturnValue("re_test_key");
    mockGetResendFromEmail.mockReturnValue("notifications@wonderagent.example");
    users = [{ id: "user-1", email: "user1@example.com" }];
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "invalid from address" }) as unknown as typeof fetch;

    await expect(
      sendNotificationEmail({ tenantId: "tenant-1", userId: "user-1", type: "critical_finding", title: "x", body: "y" }),
    ).resolves.toBeUndefined();
  });

  it("never throws when fetch itself rejects", async () => {
    mockGetResendApiKey.mockReturnValue("re_test_key");
    mockGetResendFromEmail.mockReturnValue("notifications@wonderagent.example");
    users = [{ id: "user-1", email: "user1@example.com" }];
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    await expect(
      sendNotificationEmail({ tenantId: "tenant-1", userId: "user-1", type: "critical_finding", title: "x", body: "y" }),
    ).resolves.toBeUndefined();
  });
});
