import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

test.describe("Integration module", () => {
  test.use({ storageState: authFile("adminOne") });

  test("connections lead to connection types, a type's protocol, and its connect form", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "New connection" }).click();
    await expect(page).toHaveURL("/integrations/types");
    await expect(page.getByRole("heading", { name: "Connection types" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Frappe HR", exact: true })).toBeVisible();
    // Every connection comes from a connection type; the generic form is gone.
    // The customer layout streams, so a not-found page can answer 200: check what it shows.
    await page.goto("/integrations/new");
    await expect(page.getByText("This page could not be found.")).toBeVisible();

    await page.goto("/integrations/types/builtin/keycloak");
    await expect(page.getByRole("heading", { name: "Keycloak", exact: true })).toBeVisible();
    await expect(page.getByText("OAuth 2.0 client credentials")).toBeVisible();
    await page.getByRole("link", { name: "Create connection" }).click();
    await expect(page).toHaveURL("/integrations/types/builtin/keycloak/connect");
    await expect(page.getByRole("heading", { name: "Connect Keycloak" })).toBeVisible();
    await expect(page.getByLabel("Client secret")).toHaveAttribute("type", "password");
  });

  test("the old connector catalog URLs redirect to connection types", async ({ page }) => {
    await page.goto("/integrations/connectors");
    await expect(page).toHaveURL("/integrations/types");
    await page.goto("/integrations/connectors/builtin/keycloak");
    await expect(page).toHaveURL("/integrations/types/builtin/keycloak/connect");
    await page.goto("/integrations/connectors/new");
    await expect(page).toHaveURL("/integrations/types/new");
  });

  test("a connection whose system cannot be reached is saved without credentials, and says so", async ({ page }) => {
    await page.goto("/integrations/types/builtin/gitea/connect");
    await page.getByLabel("Name").fill(`E2E Gitea ${Date.now()}`);
    await page.getByLabel("Gitea address").fill("https://e2e-connector.invalid");
    await page.getByRole("textbox", { name: "Organization" }).fill("acme");
    await page.getByLabel("Access token").fill("not-a-real-token");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page).toHaveURL(/\/integrations\/[0-9a-f-]{36}\?credentials=failed/);
    await expect(page.getByText("The connection test failed", { exact: false })).toBeVisible();
  });

  test("the authoring page checks a definition as it is typed", async ({ page }) => {
    await page.goto("/integrations/types/new");
    await expect(page.getByRole("heading", { name: "Write a connection type" })).toBeVisible();
    await expect(page.getByText("Valid: My application v1.0.0")).toBeVisible();
    await page.getByLabel("Definition (JSON)").fill('{"schemaVersion":1,"key":"x","driver":"http"}');
    await expect(page.getByRole("alert").first()).toContainText("must be lowercase");
  });

  test("a connection's credential, connection and sync actions never hit the app's error boundary", async ({ page }) => {
    const integrationName = `E2E Integration ${Date.now()}`;
    await page.goto("/integrations/types/builtin/gitea/connect");
    await page.getByLabel("Name").fill(integrationName);
    // .invalid is an RFC 2606-reserved TLD that never resolves — this
    // deliberately exercises the graceful external-failure path, not a
    // real successful connection.
    await page.getByLabel("Gitea address").fill("https://e2e-test-integration.invalid");
    await page.getByRole("textbox", { name: "Organization" }).fill("acme");
    await page.getByLabel("Access token").fill("e2e-fake-secret-value");
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(page).toHaveURL(/\/integrations\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: integrationName })).toBeVisible();

    await page.getByLabel("Access token").fill("e2e-fake-secret-value");
    await page.getByRole("button", { name: "Save credentials", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /failed|HTTP|resolve/i }).first()).toBeVisible();
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
