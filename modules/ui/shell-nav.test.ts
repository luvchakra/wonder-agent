import { describe, expect, it } from "vitest";
import { ADMIN_AREA, SHELL_NAV, activeArea, activeChildHref, isAdminPath, isNavItemActive, matchScore, navFor, searchNav, sectionPages, type ShellNavItem } from "./shell-nav";

const allHrefs = (nav: ShellNavItem[]) => nav.flatMap((item) => (item.children ? sectionPages(item).map((p) => p.href) : [item.href]));

describe("the area list (owner decision, 2026-10-13, the owner's navigation sheet)", () => {
  it("is Home, My Workspace, Access, AI Agents, Access Reviews, Risk & Detection, Self Service, then Administration", () => {
    expect(SHELL_NAV.map((s) => s.label)).toEqual(["Home", "My Workspace", "Access", "AI Agents", "Access Reviews", "Risk & Detection", "Self Service", "Administration"]);
    expect(SHELL_NAV[0]).toMatchObject({ label: "Home", href: "/" });
    expect(SHELL_NAV[SHELL_NAV.length - 1]).toBe(ADMIN_AREA);
  });

  it("arranges the Admin sidebar as the sheet's eight menus", () => {
    expect(ADMIN_AREA.children?.map((e) => e.label)).toEqual(["Identities", "Applications", "Policies & Controls", "Reports & Audit", "Users & Roles", "Integrations", "Organization Settings", "Privacy & Audit"]);
    expect(ADMIN_AREA.children?.every((e) => e.kind === "group")).toBe(true);
    for (const href of ["/settings", "/settings/users", "/integrations", "/identities", "/access", "/policies", "/reports", "/audit"]) expect(allHrefs([ADMIN_AREA])).toContain(href);
  });

  it("keeps Request Access first under Access, and Self Service for what anyone can start", () => {
    expect(sectionPages(SHELL_NAV[2]).map((p) => p.label)).toEqual(["Request Access", "All Requests", "Provisioning Tasks", "Access Packages", "Entitlements", "Request Policies"]);
    expect(sectionPages(SHELL_NAV[6]).map((p) => p.label)).toEqual(["Onboard Application", "Register Agent"]);
  });

  it("lists every href once", () => {
    const hrefs = allHrefs(SHELL_NAV);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("knows which area a page belongs to, by the best match of route and view", () => {
    expect(activeArea(SHELL_NAV, "/settings/users/123")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/integrations/sources")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/identities/attributes")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/")?.label).toBe("Home");
    expect(activeArea(SHELL_NAV, "/settings/security")?.label).toBe("My Workspace");
    expect(activeArea(SHELL_NAV, "/access/requests", "view=mine")?.label).toBe("My Workspace");
    expect(activeArea(SHELL_NAV, "/access/requests", "view=waiting")?.label).toBe("My Workspace");
    expect(activeArea(SHELL_NAV, "/access/requests")?.label).toBe("Access");
    expect(activeArea(SHELL_NAV, "/access/requests/req-1")?.label).toBe("Access");
    expect(activeArea(SHELL_NAV, "/access/fulfilment")?.label).toBe("My Workspace");
    expect(activeArea(SHELL_NAV, "/access/fulfilment", "view=all")?.label).toBe("Access");
    expect(activeArea(SHELL_NAV, "/access/applications/new")?.label).toBe("Self Service");
    expect(activeArea(SHELL_NAV, "/agents/new")?.label).toBe("Self Service");
    expect(activeArea(SHELL_NAV, "/access/applications/app-1")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/access", "status=onboarding")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/integrations/discovery")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/agents/discovery")?.label).toBe("AI Agents");
    expect(activeArea(SHELL_NAV, "/agents/agent-1")?.label).toBe("AI Agents");
    expect(activeArea(SHELL_NAV, "/runtime")?.label).toBe("AI Agents");
    expect(activeArea(SHELL_NAV, "/sod/conflicts")?.label).toBe("Risk & Detection");
    expect(activeArea(SHELL_NAV, "/sod")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/controls")?.label).toBe("Administration");
    expect(activeArea(SHELL_NAV, "/risk/rogue")?.label).toBe("Risk & Detection");
    expect(activeArea(SHELL_NAV, "/compliance/campaigns/c-1")?.label).toBe("Access Reviews");
    expect(isAdminPath("/settings")).toBe(true);
    expect(isAdminPath("/settings/security")).toBe(false);
  });

  it("marks one page current: a view in the query wins over the bare route", () => {
    const workspace = SHELL_NAV[1];
    const access = SHELL_NAV[2];
    expect(activeChildHref(workspace, "/access/requests", "view=waiting")).toBe("/access/requests?view=waiting");
    expect(activeChildHref(access, "/access/requests", "view=all")).toBe("/access/requests");
    expect(activeChildHref(access, "/access/fulfilment", "view=all")).toBe("/access/fulfilment?view=all");
    const reviews = SHELL_NAV[4];
    expect(activeChildHref(reviews, "/compliance/campaigns", "launch=1")).toBe("/compliance/campaigns?launch=1");
    expect(activeChildHref(reviews, "/compliance/campaigns")).toBe("/compliance/campaigns");
    expect(matchScore("/access/requests?view=mine", "/access/requests", "view=waiting")).toBe(-1);
  });

  it("marks exactly one area current", () => {
    expect(SHELL_NAV.filter((a) => isNavItemActive(a, "/settings/security", SHELL_NAV)).map((a) => a.label)).toEqual(["My Workspace"]);
    expect(SHELL_NAV.filter((a) => isNavItemActive(a, "/access/requests", SHELL_NAV, "view=mine")).map((a) => a.label)).toEqual(["My Workspace"]);
  });
});

describe("navFor", () => {
  it("shows a member only the pages they may open, and drops empty areas", () => {
    const nav = navFor(SHELL_NAV, ["access.read"]);
    expect(nav.map((s) => s.label)).toEqual(["Home", "My Workspace", "Access", "Administration"]);
    expect(sectionPages(nav[2]).map((p) => p.label)).toEqual(["Request Access", "All Requests", "Provisioning Tasks", "Access Packages", "Entitlements"]);
    expect(sectionPages(nav[3]).map((p) => p.label)).toEqual(["Accounts", "Application Catalog", "Onboarding Reviews", "Data Sources"]);
    expect(nav[3].href).toBe("/access/accounts");
  });

  it("gives a member with no admin permission no Administration area", () => {
    expect(navFor(SHELL_NAV, ["agent.read", "risk.read"]).map((s) => s.label)).not.toContain("Administration");
  });

  it("keeps only the admin menus the viewer may open, and leads Administration to the first", () => {
    const admin = navFor(SHELL_NAV, ["integration.read"]).find((s) => s.label === "Administration")!;
    expect(admin.children?.map((e) => e.label)).toEqual(["Identities", "Applications", "Integrations"]);
    expect(admin.href).toBe("/integrations/correlations");
    expect(navFor(SHELL_NAV, ["users.view"]).find((s) => s.label === "Administration")!.href).toBe("/settings/users");
  });

  it("moves an area's link to its first page the viewer may open", () => {
    const agents = navFor(SHELL_NAV, ["runtime.read"]).find((s) => s.label === "AI Agents")!;
    expect(agents.href).toBe("/runtime");
    expect(sectionPages(agents).map((p) => p.href)).toEqual(["/runtime"]);
  });
});

describe("searchNav (the sidebar's menu search)", () => {
  it("finds pages by name, group or area, with where they live", () => {
    expect(searchNav(SHELL_NAV, "sync")).toEqual([{ label: "Sync Jobs", href: "/integrations/jobs", trail: ["Administration", "Integrations"] }]);
    expect(searchNav(SHELL_NAV, "workforce")).toEqual([{ label: "Workforce", href: "/identities/humans", trail: ["Administration", "Identities"] }]);
    expect(searchNav(SHELL_NAV, "users roles").map((m) => m.label)).toEqual(["Users", "Roles", "Permissions", "Authorization Policies", "Single Sign-On", "API Clients"]);
    expect(searchNav(SHELL_NAV, "violations")).toEqual([{ label: "SoD Violations", href: "/sod/conflicts", trail: ["Risk & Detection"] }]);
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

describe("area menus", () => {
  it("gives every direct page of an area an icon, and every group one, so each menu row reads like an area row", () => {
    for (const area of SHELL_NAV) {
      for (const entry of area.children ?? []) {
        expect(entry.icon, `${area.label} › ${entry.label}`).toBeTruthy();
      }
    }
  });
});
