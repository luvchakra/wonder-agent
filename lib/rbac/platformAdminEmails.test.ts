import { describe, expect, it } from "vitest";
import { isListedPlatformAdmin, parsePlatformAdminEmails } from "./platformAdminEmails";

describe("PLATFORM_ADMIN_EMAILS (owner request, 2026-10-13)", () => {
  it("reads a comma-, space- or semicolon-separated list, case-insensitively, ignoring junk", () => {
    expect([...parsePlatformAdminEmails(" Admin@Example.com, ops@example.com;x  not-an-email ")]).toEqual(["admin@example.com", "ops@example.com"]);
    expect(parsePlatformAdminEmails(undefined).size).toBe(0);
    expect(parsePlatformAdminEmails("").size).toBe(0);
  });
  it("opens the console only for a listed address that Supabase Auth has confirmed", () => {
    const list = parsePlatformAdminEmails("admin@example.com");
    expect(isListedPlatformAdmin(list, { email: "ADMIN@example.com", emailConfirmedAt: "2026-10-13T00:00:00Z" })).toBe(true);
    expect(isListedPlatformAdmin(list, { email: "admin@example.com", emailConfirmedAt: null })).toBe(false);
    expect(isListedPlatformAdmin(list, { email: "other@example.com", emailConfirmedAt: "2026-10-13T00:00:00Z" })).toBe(false);
    expect(isListedPlatformAdmin(list, { email: null, emailConfirmedAt: "2026-10-13T00:00:00Z" })).toBe(false);
  });
});
