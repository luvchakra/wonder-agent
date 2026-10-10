import { describe, expect, it } from "vitest";
import { ADMIN_NAV, SHELL_NAV, adminLanding, isAdminPath, navFor, sectionPages, type ShellNavItem } from "./shell-nav";

const allHrefs = (nav: ShellNavItem[]) => nav.flatMap((item) => (item.children ? sectionPages(item).map((p) => p.href) : [item.href]));

describe("the two sidebars (owner decision, 2026-10-10)", () => {
  it("starts the main sidebar with Home and keeps organization administration out of it", () => {
    expect(SHELL_NAV[0]).toMatchObject({ label: "Home", href: "/" });
    expect(SHELL_NAV.map((s) => s.label)).not.toContain("Administration");
    for (const href of ["/settings", "/settings/users", "/settings/roles", "/integrations", "/settings/sso", "/policies"]) {
      expect(allHrefs(SHELL_NAV)).not.toContain(href);
      expect(allHrefs(ADMIN_NAV)).toContain(href);
    }
  });

  it("lists every route once across both sidebars", () => {
    const hrefs = [...allHrefs(SHELL_NAV), ...allHrefs(ADMIN_NAV)];
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("knows which pages belong to the Admin sidebar, by the longest matching section", () => {
    expect(isAdminPath("/settings")).toBe(true);
    expect(isAdminPath("/settings/users/123")).toBe(true);
    expect(isAdminPath("/integrations/sources")).toBe(true);
    expect(isAdminPath("/identities/attributes")).toBe(true);
    // Personal and work pages stay in the main sidebar, even under an admin prefix.
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/settings/security")).toBe(false);
    expect(isAdminPath("/integrations/discovery")).toBe(false);
    expect(isAdminPath("/identities/humans")).toBe(false);
    expect(isAdminPath("/agents")).toBe(false);
  });
});

describe("navFor", () => {
  it("shows a member only the pages they may open, and drops empty sections", () => {
    const nav = navFor(SHELL_NAV, ["access.read"]);
    expect(nav.map((s) => s.label)).toEqual(["Home", "My Access", "Applications", "Access Governance"]);
    const applications = nav.find((s) => s.label === "Applications")!;
    expect(sectionPages(applications).map((p) => p.label)).toEqual(["Application Inventory", "Accounts", "Data Sources"]);
  });

  it("gives a member with no admin permission no Admin entry", () => {
    expect(adminLanding(navFor(ADMIN_NAV, ["access.read", "identity.read"]))).toBeNull();
  });

  it("leads Admin to the first admin page the viewer may open", () => {
    const admin = navFor(ADMIN_NAV, ["integration.read"]);
    expect(admin.map((s) => s.label)).toEqual(["Integrations"]);
    expect(adminLanding(admin)).toBe("/integrations");
    expect(adminLanding(navFor(ADMIN_NAV, ["users.view"]))).toBe("/settings/users");
  });

  it("moves a section's link to its first page the viewer may open", () => {
    const agents = navFor(SHELL_NAV, ["runtime.read"]).find((s) => s.label === "AI Agents")!;
    expect(agents.href).toBe("/runtime");
    expect(sectionPages(agents).map((p) => p.href)).toEqual(["/runtime"]);
  });
});
