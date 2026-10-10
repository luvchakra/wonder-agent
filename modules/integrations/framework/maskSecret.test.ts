import { describe, expect, it } from "vitest";
import { maskSecret } from "./maskSecret";

describe("maskSecret", () => {
  it("shows the last four characters of a long secret, and only bullets for a short one", () => {
    expect(maskSecret("sk-live-abcdefghij3f9a")).toBe("••••••••3f9a");
    expect(maskSecret("short")).toBe("••••••••");
    expect(maskSecret("exactly12chr")).toBe("••••••••2chr");
  });

  it("never reveals a short secret and never returns the value", () => {
    expect(maskSecret("hunter2")).not.toContain("hunter");
    expect(maskSecret("sk-live-abcdefghij3f9a")).not.toContain("abcdefghij");
  });

  it("is empty for nothing stored", () => {
    expect(maskSecret(null)).toBe("");
    expect(maskSecret("")).toBe("");
  });
});
