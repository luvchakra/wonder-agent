import { describe, expect, it } from "vitest";
import { expiryReminderDue, hasEnded } from "./accessExpiryRules";

const NOW = new Date("2026-10-11T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe("time-bound access (ACCESS-P0-32)", () => {
  it("ends at its end date, never without one", () => {
    expect(hasEnded(inDays(-1), NOW)).toBe(true);
    expect(hasEnded(NOW.toISOString(), NOW)).toBe(true);
    expect(hasEnded(inDays(1), NOW)).toBe(false);
    expect(hasEnded(null, NOW)).toBe(false);
  });
  it("reminds once, inside the window, before it ends", () => {
    expect(expiryReminderDue(inDays(5), null, 7, NOW)).toBe(true);
    expect(expiryReminderDue(inDays(7), null, 7, NOW)).toBe(true);
    expect(expiryReminderDue(inDays(8), null, 7, NOW)).toBe(false);
    expect(expiryReminderDue(inDays(5), inDays(-1), 7, NOW)).toBe(false);
    expect(expiryReminderDue(inDays(-1), null, 7, NOW)).toBe(false);
    expect(expiryReminderDue(null, null, 7, NOW)).toBe(false);
  });
});
