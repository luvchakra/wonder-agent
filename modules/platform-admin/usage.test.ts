// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyUsage } from "./usage";

describe("classifyUsage — PLATFORM-P0-05.1", () => {
  it("is 'ok' below the soft-warning threshold", () => {
    expect(classifyUsage(0, 100)).toBe("ok");
    expect(classifyUsage(89, 100)).toBe("ok");
  });

  it("is 'soft_warning' at or above 90% of the limit but below it", () => {
    expect(classifyUsage(90, 100)).toBe("soft_warning");
    expect(classifyUsage(99, 100)).toBe("soft_warning");
  });

  it("is 'hard_block' at or above the limit", () => {
    expect(classifyUsage(100, 100)).toBe("hard_block");
    expect(classifyUsage(150, 100)).toBe("hard_block");
  });

  it("treats a zero limit as always hard_block, even with zero usage — there's no room at all", () => {
    expect(classifyUsage(1, 0)).toBe("hard_block");
    expect(classifyUsage(0, 0)).toBe("hard_block");
  });
});
