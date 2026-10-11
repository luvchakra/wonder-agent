import { describe, expect, it } from "vitest";
import { accountLabel, taskLabel } from "./labels";

describe("fulfilment task wording (EXPERIENCE-P0-29)", () => {
  it("says what the task asks for", () => {
    expect(taskLabel({ kind: "grant", entitlementName: "Finance", applicationName: "SAP" })).toBe("Add Finance in SAP");
    expect(taskLabel({ kind: "create_account", entitlementName: null, applicationName: "SAP" })).toBe("Create account in SAP");
  });
  it("never shows a placeholder account's internal reference", () => {
    expect(accountLabel("pending:61f7285b-7ee8-4a24-986e-8bc2dded9188")).toBe("none yet");
    expect(accountLabel("ana")).toBe("ana");
    expect(accountLabel(null)).toBe("—");
  });
});
