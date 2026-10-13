// @vitest-environment node
import { describe, expect, it } from "vitest";
import { baseAppHost, mainAddressRedirect, orgAddressRequired, parseTenantHost, slugProblem, tenantUrl } from "./host";

describe("baseAppHost", () => {
  it("normalizes the configured base host, or none", () => {
    expect(baseAppHost({ BASE_APP_HOST: " .WonderID.Example:443 " })).toBe("wonderid.example");
    expect(baseAppHost({})).toBeNull();
    expect(baseAppHost({ BASE_APP_HOST: "" })).toBeNull();
  });
});

describe("parseTenantHost", () => {
  const base = "wonderid.example";
  it("addresses a tenant by its subdomain, case- and port-insensitively", () => {
    expect(parseTenantHost("acme.wonderid.example", base)).toEqual({ kind: "subdomain", label: "acme" });
    expect(parseTenantHost("ACME.WonderID.example:3100", base)).toEqual({ kind: "subdomain", label: "acme" });
    expect(parseTenantHost("e2e-tenant-one.localhost:3100", "localhost")).toEqual({ kind: "subdomain", label: "e2e-tenant-one" });
  });
  it("recognizes the base host and anything outside the scheme", () => {
    expect(parseTenantHost("wonderid.example", base)).toEqual({ kind: "base" });
    expect(parseTenantHost("preview-123.vercel.app", base)).toEqual({ kind: "none" });
    expect(parseTenantHost("acme.wonderid.example", null)).toEqual({ kind: "none" });
    // A lookalike is not a subdomain of the base.
    expect(parseTenantHost("evilwonderid.example", base)).toEqual({ kind: "none" });
  });
  it("rejects nested, malformed and reserved addresses", () => {
    expect(parseTenantHost("a.acme.wonderid.example", base).kind).toBe("invalid");
    expect(parseTenantHost("-acme.wonderid.example", base).kind).toBe("invalid");
    expect(parseTenantHost("www.wonderid.example", base).kind).toBe("invalid");
    expect(parseTenantHost("ab.wonderid.example", base).kind).toBe("invalid");
    expect(parseTenantHost("abc.wonderid.example", base).kind).toBe("subdomain");
  });
});

describe("slugProblem", () => {
  it("accepts the policy's slugs and says why others fail", () => {
    expect(slugProblem("acme")).toBeNull();
    expect(slugProblem("e2e-tenant-one")).toBeNull();
    expect(slugProblem("Acme")).toMatch(/lowercase/);
    expect(slugProblem("a")).toMatch(/3 to 40/);
    expect(slugProblem("x".repeat(41))).toMatch(/3 to 40/);
    expect(slugProblem("acme--corp")).toMatch(/double/);
    expect(slugProblem("admin")).toMatch(/reserved/);
  });
});

describe("tenantUrl", () => {
  it("builds the primary URL when configured", () => {
    expect(tenantUrl("acme", "wonderid.example")).toBe("https://acme.wonderid.example");
    expect(tenantUrl("acme", "localhost", "http", "3100")).toBe("http://acme.localhost:3100");
    expect(tenantUrl("acme", null)).toBeNull();
  });
});

describe("organization addresses required (owner request 2026-10-13)", () => {
  it("is on only with the flag and a base host", () => {
    expect(orgAddressRequired({ ORG_ADDRESS_REQUIRED: "true", BASE_APP_HOST: "id.example.com" })).toBe(true);
    expect(orgAddressRequired({ ORG_ADDRESS_REQUIRED: "true" })).toBe(false);
    expect(orgAddressRequired({ BASE_APP_HOST: "id.example.com" })).toBe(false);
  });

  it("the main address keeps the landing page, sign-in, the vendor console and the API; product pages go to the organization list", () => {
    expect(mainAddressRedirect("/", false)).toBeNull();
    expect(mainAddressRedirect("/", true)).toBe("/organizations");
    for (const p of ["/welcome", "/sign-in", "/sign-up", "/auth/callback", "/platform-admin/tenants", "/organizations", "/onboarding/start", "/api/v1/identities", "/api/connect/v1/x/events"]) {
      expect(mainAddressRedirect(p, true)).toBeNull();
    }
    expect(mainAddressRedirect("/identities", true)).toBe("/organizations");
    expect(mainAddressRedirect("/identities", false)).toBe("/sign-in");
    // A prefix match is a whole path segment, never a look-alike.
    expect(mainAddressRedirect("/sign-inx", true)).toBe("/organizations");
    expect(mainAddressRedirect("/platform-administration", true)).toBe("/organizations");
  });
});
