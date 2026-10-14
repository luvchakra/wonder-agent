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
    expect(isListedPlatformAdmin(list, { email: "ADMIN@example.com", emailConfirmedAt: "2026-10-13T00:00:00Z", providers: ["email"] })).toBe(true);
    expect(isListedPlatformAdmin(list, { email: "admin@example.com", emailConfirmedAt: null, providers: ["email"] })).toBe(false);
    expect(isListedPlatformAdmin(list, { email: "other@example.com", emailConfirmedAt: "2026-10-13T00:00:00Z", providers: ["email"] })).toBe(false);
    expect(isListedPlatformAdmin(list, { email: null, emailConfirmedAt: "2026-10-13T00:00:00Z", providers: ["email"] })).toBe(false);
  });
  it("WID-H10: never an IdP-asserted email (enterprise SSO, Microsoft), only a method that proves the mailbox", () => {
    const list = parsePlatformAdminEmails("admin@example.com");
    const ok = { email: "admin@example.com", emailConfirmedAt: "2026-10-13T00:00:00Z" };
    expect(isListedPlatformAdmin(list, { ...ok, providers: ["google"] })).toBe(true);
    expect(isListedPlatformAdmin(list, { ...ok, isSsoUser: true, providers: ["sso:abc"] })).toBe(false);
    expect(isListedPlatformAdmin(list, { ...ok, isSsoUser: true, providers: ["email"] })).toBe(false);
    expect(isListedPlatformAdmin(list, { ...ok, providers: ["email", "sso:abc"] })).toBe(false);
    expect(isListedPlatformAdmin(list, { ...ok, providers: ["azure"] })).toBe(false);
    expect(isListedPlatformAdmin(list, { ...ok, providers: [] })).toBe(false);
    expect(isListedPlatformAdmin(list, { ...ok, providers: ["azure", "email"] })).toBe(true);
  });
});
