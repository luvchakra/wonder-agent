import { describe, expect, it } from "vitest";
import { ADMIN_AREA, SHELL_NAV, activeArea, isAdminPath, isNavItemActive, navFor, searchNav, sectionPages, type ShellNavItem } from "./shell-nav";

const allHrefs = (nav: ShellNavItem[]) => nav.flatMap((item) => (item.children ? sectionPages(item).map((p) => p.href) : [item.href]));

describe("the area list (owner decision, 2026-10-10)", () => {
  it("starts with Home and ends with Admin, which holds all organization administration", () => {
    expect(SHELL_NAV[0]).toMatchObject({ label: "Home", href: "/" });
    expect(SHELL_NAV[SHELL_NAV.length - 1]).toBe(ADMIN_AREA);
    expect(SHELL_NAV.map((s) => s.label)).toEqual(["Home", "Identities", "Applications", "Certifications", "Risk & Security", "AI Agents", "Insights", "Admin"]);
    for (const href of ["/settings", "/settings/users", "/settings/roles", "/integrations", "/settings/sso", "/policies"]) {
      expect(allHrefs([ADMIN_AREA])).toContain(href);
    }
  });

  it("keeps a member's day-to-day work in Home", () => {
    expect(sectionPages(SHELL_NAV[0]).map((p) => p.href)).toEqual(["/", "/access/catalog", "/my-privacy", "/settings/security", "/access/requests", "/access/packages"]);
  });

  it("lists every route once", () => {
    const hrefs = allHrefs(SHELL_NAV);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("knows which area a page belongs to, by the longest matching prefix", () => {
    expect(activeArea(SHELL_NAV, "/settings/users/123")?.label).toBe("Admin");
    expect(activeArea(SHELL_NAV, "/integrations/sources")?.label).toBe("Admin");
    expect(activeArea(SHELL_NAV, "/identities/attributes")?.label).toBe("Admin");
    expect(activeArea(SHELL_NAV, "/")?.label).toBe("Home");
    // A member's own pages under an admin prefix stay in Home.
    expect(activeArea(SHELL_NAV, "/settings/security")?.label).toBe("Home");
    expect(activeArea(SHELL_NAV, "/access/requests/req-1")?.label).toBe("Home");
    expect(activeArea(SHELL_NAV, "/integrations/discovery")?.label).toBe("Applications");
    expect(activeArea(SHELL_NAV, "/access/agents/agent-1")?.label).toBe("Applications");
    expect(activeArea(SHELL_NAV, "/identities/humans")?.label).toBe("Identities");
    expect(activeArea(SHELL_NAV, "/agents/discovery")?.label).toBe("AI Agents");
    expect(isAdminPath("/settings")).toBe(true);
    expect(isAdminPath("/settings/security")).toBe(false);
  });

  it("marks exactly one area current", () => {
    expect(SHELL_NAV.filter((a) => isNavItemActive(a, "/settings/security", SHELL_NAV)).map((a) => a.label)).toEqual(["Home"]);
  });
});

describe("navFor", () => {
  it("shows a member only the pages they may open, and drops empty areas", () => {
    const nav = navFor(SHELL_NAV, ["access.read"]);
    expect(nav.map((s) => s.label)).toEqual(["Home", "Applications"]);
    expect(sectionPages(nav[0]).map((p) => p.label)).toEqual(["Home", "Request Access", "My Privacy", "Sign-in Security", "Access Requests", "Access Packages"]);
    expect(sectionPages(nav[1]).map((p) => p.label)).toEqual(["Application Inventory", "Accounts", "Data Sources"]);
  });

  it("gives a member with no admin permission no Admin area", () => {
    expect(navFor(SHELL_NAV, ["access.read", "identity.read"]).map((s) => s.label)).not.toContain("Admin");
  });

  it("keeps only the admin groups the viewer may open, and leads Admin to the first", () => {
    const admin = navFor(SHELL_NAV, ["integration.read"]).find((s) => s.label === "Admin")!;
    expect(admin.children?.map((e) => e.label)).toEqual(["Integrations"]);
    expect(admin.href).toBe("/integrations");
    expect(navFor(SHELL_NAV, ["users.view"]).find((s) => s.label === "Admin")!.href).toBe("/settings/users");
  });

  it("moves an area's link to its first page the viewer may open", () => {
    const agents = navFor(SHELL_NAV, ["runtime.read"]).find((s) => s.label === "AI Agents")!;
    expect(agents.href).toBe("/runtime");
    expect(sectionPages(agents).map((p) => p.href)).toEqual(["/runtime"]);
  });
});

describe("searchNav (the sidebar's menu search)", () => {
  it("finds pages by name, group or area, with where they live", () => {
    expect(searchNav(SHELL_NAV, "sync")).toEqual([{ label: "Sync Jobs", href: "/integrations/jobs", trail: ["Admin", "Integrations"] }]);
    expect(searchNav(SHELL_NAV, "people")).toEqual([{ label: "People", href: "/identities/humans", trail: ["Identities"] }]);
    expect(searchNav(SHELL_NAV, "admin roles").map((m) => m.label)).toEqual(["WonderID Roles"]);
  });

  it("returns nothing for an empty or unmatched query, and at most the limit", () => {
    expect(searchNav(SHELL_NAV, "   ")).toEqual([]);
    expect(searchNav(SHELL_NAV, "zzz")).toEqual([]);
    expect(searchNav(SHELL_NAV, "a", 3)).toHaveLength(3);
  });

  it("searches only what the viewer may open", () => {
    expect(searchNav(navFor(SHELL_NAV, ["access.read"]), "sync")).toEqual([]);
  });
});
