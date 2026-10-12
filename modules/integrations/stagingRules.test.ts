import { describe, expect, it } from "vitest";
import { heldKinds, kindCompleteness, missingStatusOf, type KindRun } from "./stagingRules";
import { chooseRunMode } from "./stagingRules";

const clean: KindRun = { failed: false, storeFailures: 0, unmapped: 0, truncated: false, unread: false };

describe("kindCompleteness", () => {
  it("lets only a clean full run mark objects missing", () => {
    expect(kindCompleteness("full", clean)).toEqual({ complete: true });
  });

  it("never marks on a partial or incremental run", () => {
    expect(kindCompleteness("partial", clean)).toEqual({ complete: false, reason: "partial run" });
    expect(kindCompleteness("incremental", clean)).toEqual({ complete: false, reason: "incremental run" });
  });

  it.each([
    [{ failed: true }, "the import of this kind failed"],
    [{ unread: true }, "nothing was read (no new file)"],
    [{ truncated: true }, "the read stopped at a limit"],
    [{ storeFailures: 3 }, "3 records could not be stored"],
    [{ unmapped: 1 }, "some records could not be mapped"],
  ])("skips a full run that read incompletely (%o)", (change, reason) => {
    expect(kindCompleteness("full", { ...clean, ...change })).toEqual({ complete: false, reason });
  });
});

describe("missingStatusOf", () => {
  it("is held when any kind is held, even if others were marked", () => {
    expect(
      missingStatusOf({
        account: { status: "marked", marked: 2, candidates: 2, presentBefore: 10 },
        identity: { status: "held", candidates: 15, presentBefore: 25, thresholdPercent: 20 },
      }),
    ).toBe("held");
  });

  it("is applied only when something was actually marked", () => {
    expect(missingStatusOf({ account: { status: "marked", marked: 1, candidates: 1, presentBefore: 9 } })).toBe("applied");
    expect(missingStatusOf({ account: { status: "marked", marked: 0, candidates: 0, presentBefore: 9 } })).toBe("none");
    expect(missingStatusOf({ account: { status: "skipped", reason: "partial run" } })).toBe("none");
    expect(missingStatusOf({})).toBe("none");
  });
});

describe("heldKinds", () => {
  it("lists only the held kinds", () => {
    expect(
      heldKinds({
        account: { status: "marked", marked: 1, candidates: 1, presentBefore: 9 },
        identity: { status: "held", candidates: 15, presentBefore: 25, thresholdPercent: 20 },
        entitlement: { status: "skipped", reason: "partial run" },
      }),
    ).toEqual(["identity"]);
  });
});

describe("chooseRunMode (INTEGRATION-P0-21)", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const base = { requested: "full" as const, trigger: "scheduled", supportsIncremental: true, lastSucceededStart: "2026-10-12T11:00:00Z", lastFullSucceededStart: "2026-10-12T02:00:00Z", now };

  it("a scheduled run reads only what changed since just before the last good run", () => {
    expect(chooseRunMode(base)).toEqual({ mode: "incremental", since: new Date("2026-10-12T10:55:00Z") });
    expect(chooseRunMode({ ...base, trigger: "manual", requested: "incremental" }).mode).toBe("incremental");
  });

  it("reads in full when it cannot read changes, has no cursor, or the daily full run is due", () => {
    expect(chooseRunMode({ ...base, supportsIncremental: false })).toMatchObject({ mode: "full", since: null, reason: expect.stringMatching(/cannot read only changes/) });
    expect(chooseRunMode({ ...base, lastSucceededStart: null })).toMatchObject({ mode: "full", reason: expect.stringMatching(/no earlier/) });
    expect(chooseRunMode({ ...base, lastFullSucceededStart: null })).toMatchObject({ mode: "full" });
    expect(chooseRunMode({ ...base, lastFullSucceededStart: "2026-10-11T11:59:00Z" })).toMatchObject({ mode: "full", reason: expect.stringMatching(/daily full run/) });
  });

  it("sync now, verification after a write and file imports keep their own mode", () => {
    expect(chooseRunMode({ ...base, trigger: "manual" })).toEqual({ mode: "full", since: null });
    expect(chooseRunMode({ ...base, trigger: "verification" })).toEqual({ mode: "full", since: null });
    expect(chooseRunMode({ ...base, requested: "partial" })).toEqual({ mode: "partial", since: null });
  });
});
