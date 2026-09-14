// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveJitRole } from "./sso";

describe("resolveJitRole — FOUNDATION-P0-03.3", () => {
  it("returns the connection's default role when no roleClaim is configured", () => {
    const role = resolveJitRole(
      { groups: ["Engineering"] },
      { claimsMapping: {}, defaultRole: "READ_ONLY" },
    );
    expect(role).toBe("READ_ONLY");
  });

  it("maps a matching IdP claim value to the configured system role", () => {
    const role = resolveJitRole(
      { role: "IAM-Admins" },
      {
        claimsMapping: { roleClaim: "role", roleValueMap: { "IAM-Admins": "IAM_ADMIN" } },
        defaultRole: "READ_ONLY",
      },
    );
    expect(role).toBe("IAM_ADMIN");
  });

  it("matches against an array-valued claim (e.g. multi-valued groups)", () => {
    const role = resolveJitRole(
      { groups: ["Everyone", "Security-Admins"] },
      {
        claimsMapping: { roleClaim: "groups", roleValueMap: { "Security-Admins": "SECURITY_ADMIN" } },
        defaultRole: "READ_ONLY",
      },
    );
    expect(role).toBe("SECURITY_ADMIN");
  });

  it("falls back to the default role when the claim value has no mapping entry", () => {
    const role = resolveJitRole(
      { role: "Unmapped-Group" },
      {
        claimsMapping: { roleClaim: "role", roleValueMap: { "IAM-Admins": "IAM_ADMIN" } },
        defaultRole: "READ_ONLY",
      },
    );
    expect(role).toBe("READ_ONLY");
  });

  it("falls back to the default role when the claim itself is missing from the token", () => {
    const role = resolveJitRole(
      {},
      {
        claimsMapping: { roleClaim: "role", roleValueMap: { "IAM-Admins": "IAM_ADMIN" } },
        defaultRole: "READ_ONLY",
      },
    );
    expect(role).toBe("READ_ONLY");
  });
});
