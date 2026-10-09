import { describe, expect, it } from "vitest";
import { firstOrganizationName, newTenantSlug, slugify } from "./organizationName";

describe("firstOrganizationName", () => {
  it("names a company address after the company", () => {
    expect(firstOrganizationName("ava@acme.com")).toBe("Acme");
    expect(firstOrganizationName("ava@acme-corp.com", "Ava Chen")).toBe("Acme Corp");
    expect(firstOrganizationName("ava@mail.northwind.io")).toBe("Northwind");
    expect(firstOrganizationName("ava@acme.co.uk")).toBe("Acme");
    expect(firstOrganizationName("ava@acme.com.au")).toBe("Acme");
    expect(firstOrganizationName("raj@wonderapps.biz")).toBe("Wonderapps");
  });

  it("names a personal address after the person", () => {
    expect(firstOrganizationName("ava.chen@gmail.com", "Ava Chen")).toBe("Ava's organization");
    expect(firstOrganizationName("ava.chen@outlook.com")).toBe("Ava's organization");
    expect(firstOrganizationName("Ava.Chen@GMAIL.com")).toBe("Ava's organization");
    expect(firstOrganizationName("2luvchakra@gmail.com")).toBe("Luvchakra's organization");
  });

  it("falls back when nothing usable is known", () => {
    expect(firstOrganizationName(null)).toBe("My organization");
    expect(firstOrganizationName("123@gmail.com")).toBe("My organization");
    expect(firstOrganizationName("x@localhost")).toBe("X's organization");
  });

  it("produces a name the slug policy accepts", () => {
    const slug = newTenantSlug(firstOrganizationName("ava@gmail.com", "Ava"));
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slugify("Ava's organization")).toBe("ava-s-organization");
  });
});
