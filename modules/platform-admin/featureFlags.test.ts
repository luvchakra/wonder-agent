// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveFlags } from "./featureFlags";

describe("resolveFlags — PLATFORM-P0-12", () => {
  const catalog = [
    { key: "runtime_observe", default_enabled: true },
    { key: "runtime_enforce", default_enabled: false },
  ];

  it("uses the catalog default when the tenant has no override", () => {
    expect(resolveFlags(["runtime_observe", "runtime_enforce"], [], catalog)).toEqual({ runtime_observe: true, runtime_enforce: false });
  });

  it("a tenant override wins in either direction", () => {
    expect(
      resolveFlags(
        ["runtime_observe", "runtime_enforce"],
        [
          { flag_key: "runtime_enforce", enabled: true },
          { flag_key: "runtime_observe", enabled: false },
        ],
        catalog,
      ),
    ).toEqual({ runtime_observe: false, runtime_enforce: true });
  });

  it("a flag missing from the catalog is off (fail closed)", () => {
    expect(resolveFlags(["no_such_flag"], [], catalog)).toEqual({ no_such_flag: false });
  });
});
