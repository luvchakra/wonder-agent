import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * Every top-level customer route (list/index pages only — dynamic
 * detail routes are covered by each module's own spec, since they need
 * real seeded ids) loads for a TENANT_SUPER_ADMIN with no thrown error,
 * no 4xx/5xx response, and no browser console error. This is the broad,
 * shallow half of coverage; each module spec below is the deep half.
 */
const ROUTES = [
  { path: "/", heading: "AI Agent Security Overview" },
  { path: "/agents", heading: "AI Agents" },
  { path: "/agents/new", heading: "Register an AI Agent" },
  { path: "/agents/discovery", heading: null },
  { path: "/agents/duplicates", heading: "Duplicate registration review" },
  { path: "/access", heading: "Applications" },
  { path: "/access/requests", heading: "Access Requests" },
  { path: "/access/accounts", heading: "Accounts" },
  { path: "/policies", heading: "Policies" },
  { path: "/runtime", heading: "Runtime activity" },
  { path: "/risk", heading: "Risks & alerts" },
  { path: "/risk/rogue", heading: "Rogue Agents" },
  { path: "/compliance/campaigns", heading: "Certification" },
  { path: "/integrations", heading: "Integrations" },
  { path: "/integrations/new", heading: "Add an integration" },
  { path: "/integrations/jobs", heading: "Job Status" },
  { path: "/audit", heading: "Audit Trail" },
  { path: "/reports", heading: "Reports" },
  { path: "/search", heading: "Search" },
  { path: "/settings", heading: "Administration" },
  { path: "/settings/roles", heading: "Users & Roles" },
  { path: "/settings/sso", heading: "Single Sign-On" },
  { path: "/settings/security", heading: null },
  { path: "/settings/notifications", heading: "Notification Preferences" },
  { path: "/settings/ai", heading: "AI Provider" },
];

test.describe("navigation smoke — every top-level customer route", () => {
  test.use({ storageState: authFile("adminOne") });

  for (const route of ROUTES) {
    test(`${route.path} loads without error`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      const pageErrors: Error[] = [];
      page.on("pageerror", (err) => pageErrors.push(err));

      const response = await page.goto(route.path);
      expect(response?.ok(), `${route.path} returned ${response?.status()}`).toBe(true);

      await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
      if (route.heading) {
        await expect(page.getByRole("heading", { name: route.heading, exact: false }).first()).toBeVisible();
      }

      expect(pageErrors, `${route.path} threw ${pageErrors.length} uncaught error(s): ${pageErrors.map((e) => e.message).join("; ")}`).toHaveLength(0);
      expect(consoleErrors, `${route.path} logged console error(s): ${consoleErrors.join("; ")}`).toHaveLength(0);
    });
  }
});

test.describe("navigation smoke — platform-admin console", () => {
  test.use({ storageState: authFile("platformAdmin") });

  const PLATFORM_ROUTES = [
    { path: "/platform-admin", heading: null },
    { path: "/platform-admin/tenants", heading: null },
    { path: "/platform-admin/features", heading: null },
    { path: "/platform-admin/branding", heading: null },
    { path: "/platform-admin/announcements", heading: null },
    { path: "/platform-admin/health", heading: null },
    { path: "/platform-admin/admins", heading: null },
  ];

  for (const route of PLATFORM_ROUTES) {
    test(`${route.path} loads without error`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.ok(), `${route.path} returned ${response?.status()}`).toBe(true);
      await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
    });
  }
});
