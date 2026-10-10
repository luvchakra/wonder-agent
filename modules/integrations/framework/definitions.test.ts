import { describe, expect, it } from "vitest";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { validateDefinition } from "./validate";
import { capabilitiesOf } from "./engine";

describe("built-in connector definitions", () => {
  it("have unique keys", () => {
    const keys = BUILTIN_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const def of BUILTIN_DEFINITIONS) {
    it(`${def.key} is valid and declares what it imports or receives`, () => {
      expect(validateDefinition(def).issues).toEqual([]);
      const caps = capabilitiesOf(def);
      expect(Object.values(caps).some(Boolean) || Object.keys(def.receive ?? {}).length > 0).toBe(true);
      expect(caps.provision).toBe(false);
    });
  }
});
