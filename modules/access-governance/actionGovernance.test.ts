// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyAction } from "./actionGovernance";

const contract = {
  approvedActions: ["READ", "REPORT"],
  prohibitedActions: ["DELETE"],
  actionsRequiringApproval: ["EXPORT", "TRANSFER"],
};

describe("classifyAction — ACCESS-P0-06 action governance 4-state model", () => {
  it("classifies an approved action as allowed", () => {
    expect(classifyAction(contract, "READ")).toBe("allowed");
  });

  it("classifies an action requiring approval as allowed_with_approval", () => {
    expect(classifyAction(contract, "EXPORT")).toBe("allowed_with_approval");
  });

  it("classifies a prohibited action as prohibited even if it also appeared elsewhere", () => {
    expect(classifyAction(contract, "DELETE")).toBe("prohibited");
  });

  it("defaults an action the contract never mentions to restricted, never allowed", () => {
    expect(classifyAction(contract, "DEPLOY")).toBe("restricted");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(classifyAction(contract, "  read  ")).toBe("allowed");
    expect(classifyAction(contract, "Delete")).toBe("prohibited");
  });

  it("prohibited takes priority over approved when an action is listed in both (contradictory contract)", () => {
    const contradictory = { approvedActions: ["SEND"], prohibitedActions: ["SEND"], actionsRequiringApproval: [] };
    expect(classifyAction(contradictory, "SEND")).toBe("prohibited");
  });
});
