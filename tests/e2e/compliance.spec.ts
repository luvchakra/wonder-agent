import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

// COMPLIANCE-P0-01.2's 5 scope types all have real population logic, but
// the campaign-launch FORM only ever sends `scope: {criticality: [...]}}`
// or `{}` (app/actions/compliance.ts) — it has no `applicationId`/
// `entitlementId` inputs (deliberately left API-level-only; see that
// story's backlog notes). So launching via THIS form with "application"/
// "entitlement" selected always fails scope validation before this UI
// gains those fields — asserting that today, not "no error", so this
// test breaks the day someone adds the missing inputs (a welcome break).
const SCOPE_TYPES_THAT_SUCCEED = ["agent", "privileged_access", "high_risk_agent"] as const;
const SCOPE_TYPES_THAT_FAIL_VALIDATION = ["application", "entitlement"] as const;

test.describe("Compliance module", () => {
  test.use({ storageState: authFile("adminOne") });

  test("list page shows the launch-campaign form", async ({ page }) => {
    await page.goto("/compliance/campaigns");
    await expect(page.getByRole("heading", { name: "Certification Campaigns" })).toBeVisible();
    await expect(page.getByLabel("Campaign name")).toBeVisible();
  });

  test("launching an agent-scope campaign redirects straight to its detail page with a metrics summary", async ({ page }) => {
    const campaignName = `E2E Campaign ${Date.now()}`;
    await page.goto("/compliance/campaigns");
    await page.getByLabel("Campaign name").fill(campaignName);
    await page.getByRole("button", { name: "Launch", exact: true }).click();

    await expect(page).toHaveURL(/\/compliance\/campaigns\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: "Certification Items" })).toBeVisible();
    await expect(page.getByText(/\d+ total · \d+ pending · \d+ decided · \d+ overdue · \d+ escalated/)).toBeVisible();

    await page.goto("/compliance/campaigns");
    await expect(page.getByRole("row", { name: new RegExp(campaignName) })).toBeVisible();
  });

  for (const scopeType of SCOPE_TYPES_THAT_SUCCEED) {
    test(`launching a "${scopeType}" scope campaign succeeds from this form`, async ({ page }) => {
      await page.goto("/compliance/campaigns");
      await page.getByLabel("Campaign name").fill(`E2E ${scopeType} Campaign ${Date.now()}`);
      await page.getByLabel("Scope type").selectOption(scopeType);
      await page.getByRole("button", { name: "Launch", exact: true }).click();

      await expect(page).toHaveURL(/\/compliance\/campaigns\/[0-9a-f-]{36}/);
      await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
    });
  }

  for (const scopeType of SCOPE_TYPES_THAT_FAIL_VALIDATION) {
    test(`launching a "${scopeType}" scope campaign from this form fails scope validation (no UI input for it yet)`, async ({ page }) => {
      await page.goto("/compliance/campaigns");
      await page.getByLabel("Campaign name").fill(`E2E ${scopeType} Campaign ${Date.now()}`);
      await page.getByLabel("Scope type").selectOption(scopeType);
      await page.getByRole("button", { name: "Launch", exact: true }).click();

      await expect(page.getByText(/an unexpected error occurred/i)).toBeVisible();
    });
  }
});
