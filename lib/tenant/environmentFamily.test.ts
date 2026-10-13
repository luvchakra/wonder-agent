import { describe, expect, it } from "vitest";
import { environmentSiblings, type EnvironmentMember } from "./environmentFamily";

const m = (tenantId: string, slug: string, environment: string, parentTenantId: string | null = null): EnvironmentMember => ({ tenantId, slug, environment, parentTenantId });

describe("environmentSiblings (owner request 2026-10-13)", () => {
  it("groups environments the platform linked to their production organization, production first", () => {
    const all = [m("dev", "acme-dev", "development", "prod"), m("prod", "acme", "production"), m("other", "globex", "production"), m("test", "acme-test", "test", "prod")];
    expect(environmentSiblings("dev", all).map((x) => x.tenantId)).toEqual(["prod", "dev", "test"]);
    expect(environmentSiblings("prod", all).map((x) => x.tenantId)).toEqual(["prod", "dev", "test"]);
  });

  it("groups unlinked organizations by their address prefix", () => {
    const all = [m("a", "acme", "production"), m("b", "acme-staging", "staging"), m("c", "acme-corp", "production")];
    expect(environmentSiblings("b", all).map((x) => x.slug)).toEqual(["acme", "acme-staging"]);
  });

  it("an organization with no other environments has no switch", () => {
    expect(environmentSiblings("x", [m("x", "solo", "production"), m("y", "other-dev", "development")])).toEqual([]);
    expect(environmentSiblings("missing", [])).toEqual([]);
  });
});
