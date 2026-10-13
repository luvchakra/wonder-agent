import { describe, expect, it } from "vitest";
import type { PlatformTenant } from "@/lib/shared/types/platform";
import { groupOrganizations } from "./organizations";

const t = (tenantId: string, slug: string, environment: PlatformTenant["environment"], parentTenantId: string | null = null): PlatformTenant => ({ tenantId, slug, name: slug, environment, parentTenantId, notes: null, createdAt: "2026-10-13", status: "active" });

describe("groupOrganizations (owner request 2026-10-13)", () => {
  it("one organization per production tenant, holding its linked environments, production first", () => {
    const orgs = groupOrganizations([t("dev", "acme-dev", "development", "prod"), t("prod", "acme", "production"), t("test", "acme-test", "test", "prod"), t("g", "globex", "production")]);
    expect(orgs).toHaveLength(2);
    const acme = orgs.find((o) => o.id === "prod")!;
    expect(acme.environments.map((e) => e.tenantId)).toEqual(["prod", "test", "dev"]);
  });

  it("groups unlinked environments by address prefix, and an environment with no production still forms its own organization", () => {
    const orgs = groupOrganizations([t("a", "acme", "production"), t("b", "acme-staging", "staging"), t("c", "solo-dev", "development")]);
    expect(orgs.map((o) => o.environments.map((e) => e.slug))).toEqual([["acme", "acme-staging"], ["solo-dev"]]);
  });
});
