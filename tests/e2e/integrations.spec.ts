import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

test.describe("Integration module", () => {
  test.use({ storageState: authFile("adminOne") });

  test("list page leads to the connector catalog, and from there to a connector's form", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
    await page.getByRole("link", { name: "+ Connect a system" }).click();
    await expect(page).toHaveURL("/integrations/connectors");
    await expect(page.getByRole("heading", { name: "Connect a system" })).toBeVisible();
    await expect(page.getByText("Frappe HR", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "add a generic integration" }).click();
    await expect(page.getByRole("heading", { name: "Add an integration" })).toBeVisible();
    await page.goto("/integrations/connectors/builtin/keycloak");
    await expect(page.getByRole("heading", { name: "Connect Keycloak" })).toBeVisible();
    await expect(page.getByLabel("Client secret")).toHaveAttribute("type", "password");
  });

  test("a connector whose system cannot be reached is saved without credentials, and says so", async ({ page }) => {
    await page.goto("/integrations/connectors/builtin/gitea");
    await page.getByLabel("Name").fill(`E2E Gitea ${Date.now()}`);
    await page.getByLabel("Gitea address").fill("https://e2e-connector.invalid");
    await page.getByRole("textbox", { name: "Organization" }).fill("acme");
    await page.getByLabel("Access token").fill("not-a-real-token");
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page).toHaveURL(/\/integrations\/[0-9a-f-]{36}\?credentials=failed/);
    await expect(page.getByText("The connection test failed", { exact: false })).toBeVisible();
  });

  test("the authoring page checks a definition as it is typed", async ({ page }) => {
    await page.goto("/integrations/connectors/new");
    await expect(page.getByText("Valid: My application v1.0.0")).toBeVisible();
    await page.getByLabel("Definition (JSON)").fill('{"schemaVersion":1,"key":"x","driver":"http"}');
    await expect(page.getByRole("alert").first()).toContainText("must be lowercase");
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
