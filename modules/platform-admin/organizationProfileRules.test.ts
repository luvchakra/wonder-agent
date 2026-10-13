import { describe, expect, it } from "vitest";
import { validateOrganizationProfile } from "./organizationProfileRules";

describe("validateOrganizationProfile (owner request 2026-10-13)", () => {
  it("trims, normalises and treats empty as not recorded", () => {
    const r = validateOrganizationProfile({ contactName: "  Ava Chen ", contactEmail: "Ava@Example.COM", country: "in", website: "", industry: "Banking", userBaseSize: "201-1000" });
    expect(r).toEqual({
      ok: true,
      value: {
        description: null,
        contactName: "Ava Chen",
        contactEmail: "ava@example.com",
        contactPhone: null,
        companyName: null,
        companyEmail: null,
        companyPhone: null,
        industry: "Banking",
        userBaseSize: "201-1000",
        country: "IN",
        website: null,
      },
    });
  });

  it("refuses bad emails, phones, sizes, countries and websites in words", () => {
    const r = validateOrganizationProfile({ contactEmail: "nope", companyPhone: "call me", userBaseSize: "lots", country: "India", website: "example.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["companyPhone", "contactEmail", "country", "userBaseSize", "website"]);
  });

  it("accepts international phone numbers", () => {
    expect(validateOrganizationProfile({ contactPhone: "+91 (22) 4000-1234" }).ok).toBe(true);
  });
});
