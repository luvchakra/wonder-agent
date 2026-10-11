import { describe, expect, it } from "vitest";
import { heldKinds, kindCompleteness, missingStatusOf, type KindRun } from "./stagingRules";

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
