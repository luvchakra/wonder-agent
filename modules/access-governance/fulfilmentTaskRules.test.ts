import { describe, expect, it } from "vitest";
import { canAct, dueAt, isOverdue, needsReminder, needsUnconfirmedRemovalReminder, taskDueAt } from "./fulfilmentTaskRules";

const owner = { userId: "u-owner", identityId: "i-owner", canApprove: false };
const manager = { userId: "u-mgr", identityId: null, canApprove: true };
const stranger = { userId: "u-x", identityId: "i-x", canApprove: false };
const task = (status: "open" | "claimed" | "completed" | "failed" | "verified" | "cancelled", claimedBy: string | null = null) => ({ status, assigneeIdentityId: "i-owner", claimedBy });

describe("canAct (ACCESS-P0-29)", () => {
  it("lets the owner or an access manager claim an open or failed task, and nobody else", () => {
    expect(canAct(task("open"), owner, "claim")).toEqual({ ok: true, to: "claimed" });
    expect(canAct(task("failed"), manager, "claim")).toEqual({ ok: true, to: "claimed" });
    expect(canAct(task("open"), stranger, "claim")).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("keeps a claimed task with its claimer, unless an access manager steps in", () => {
    expect(canAct(task("claimed", "u-owner"), owner, "complete")).toEqual({ ok: true, to: "completed" });
    expect(canAct(task("claimed", "u-mgr"), owner, "fail")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(canAct(task("claimed", "u-owner"), manager, "fail")).toEqual({ ok: true, to: "failed" });
  });
  it("refuses to move a finished task", () => {
    for (const s of ["completed", "verified", "cancelled"] as const) expect(canAct(task(s), manager, "complete")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(canAct(task("claimed", "u-owner"), owner, "claim")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });
});

describe("SLA", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("is due the SLA's days after opening, and overdue only while still to do", () => {
    expect(dueAt(now, 3)).toBe("2026-10-14T12:00:00.000Z");
    // WID-C02: removals and disables are due within a day; granting keeps the organization's SLA.
    expect(taskDueAt("grant", now, 3)).toBe("2026-10-14T12:00:00.000Z");
    expect(taskDueAt("remove", now, 3)).toBe("2026-10-12T12:00:00.000Z");
    expect(taskDueAt("disable_account", now, 3)).toBe("2026-10-12T12:00:00.000Z");
    expect(isOverdue({ status: "open", dueAt: "2026-10-10T00:00:00Z" }, now)).toBe(true);
    expect(isOverdue({ status: "completed", dueAt: "2026-10-10T00:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ status: "claimed", dueAt: "2026-10-12T00:00:00Z" }, now)).toBe(false);
  });
  it("reminds an overdue task at most once a day", () => {
    const overdue = { status: "open" as const, dueAt: "2026-10-10T00:00:00Z" };
    expect(needsReminder({ ...overdue, remindedAt: null }, now)).toBe(true);
    expect(needsReminder({ ...overdue, remindedAt: "2026-10-11T06:00:00Z" }, now)).toBe(false);
    expect(needsReminder({ ...overdue, remindedAt: "2026-10-10T11:00:00Z" }, now)).toBe(true);
  });
});

describe("WID-C02: removals marked done but not confirmed", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const task = (over: Partial<Parameters<typeof needsUnconfirmedRemovalReminder>[0]> = {}) => ({ kind: "remove", status: "completed" as const, completedAt: "2026-10-09T12:00:00Z", remindedAt: null, ...over });
  it("reminds after two days without confirmation, then at most daily", () => {
    expect(needsUnconfirmedRemovalReminder(task(), now)).toBe(true);
    expect(needsUnconfirmedRemovalReminder(task({ completedAt: "2026-10-11T12:00:00Z" }), now)).toBe(false);
    expect(needsUnconfirmedRemovalReminder(task({ remindedAt: "2026-10-12T06:00:00Z" }), now)).toBe(false);
    expect(needsUnconfirmedRemovalReminder(task({ remindedAt: "2026-10-11T06:00:00Z" }), now)).toBe(true);
  });
  it("only removals still waiting for the system", () => {
    expect(needsUnconfirmedRemovalReminder(task({ kind: "grant" }), now)).toBe(false);
    expect(needsUnconfirmedRemovalReminder(task({ status: "verified" }), now)).toBe(false);
    expect(needsUnconfirmedRemovalReminder(task({ completedAt: null }), now)).toBe(false);
  });
});
