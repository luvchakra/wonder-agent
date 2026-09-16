import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

test.describe("Integration module", () => {
  test.use({ storageState: authFile("adminOne") });

  test("list page shows the add-integration entry point", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
    await page.getByRole("link", { name: "+ Add integration" }).click();
    await expect(page).toHaveURL("/integrations/new");
    await expect(page.getByRole("heading", { name: "Add an integration" })).toBeVisible();
  });

  test("creating an integration redirects to its detail page, and credential/connection/sync actions never hit the app's error boundary", async ({ page }) => {
    const integrationName = `E2E Integration ${Date.now()}`;
    await page.goto("/integrations/new");
    await page.getByLabel("Name").fill(integrationName);
    // .invalid is an RFC 2606-reserved TLD that never resolves — this
    // deliberately exercises the graceful external-failure path, not a
    // real successful connection.
    await page.getByLabel("Base URL").fill("https://e2e-test-integration.invalid");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page).toHaveURL(/\/integrations\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: integrationName })).toBeVisible();

    await page.getByLabel("Secret / token").fill("e2e-fake-secret-value");
    await page.getByRole("button", { name: "Save credential", exact: true }).click();
    await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();

    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();

    await page.getByRole("button", { name: "Run sync now", exact: true }).click();
    await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
  });

  test("job status page loads", async ({ page }) => {
    await page.goto("/integrations/jobs");
    await expect(page.getByRole("heading", { name: "Job Status" })).toBeVisible();
  });
});
