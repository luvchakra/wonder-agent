import { test, expect } from "@playwright/test";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug, seedFinanceBotAccess } from "./support/seedFinanceBotAccess";

/**
 * CLAUDE.md §11's central acceptance scenario, driven end-to-end through
 * the real UI (not the `tests/access/*.sql` fixture, which exercises the
 * same scenario at the SQL/RLS level for tenant-isolation proof — this is
 * the browser-level proof the same scenario actually works through the
 * product). The scenario's CAN half (Application → Account → Entitlement
 * → AccessGrant) has no UI creation path yet — accounts only ever arrive
 * via an integration sync — so it's seeded via seedFinanceBotAccess()
 * (Supabase Admin API, same shape the SQL fixture already builds); SHOULD
 * (the contract), DID (a runtime event), evaluation, remediation and
 * resolution are all driven through the real forms/buttons.
 */
test.describe("FinanceBot central scenario (CLAUDE.md §11)", () => {
  test.use({ storageState: authFile("adminOne") });

  test("SHOULD = financial reporting only, CAN + DID = CustomerDB → excessive access finding → remediate → revoke → resolve", async ({ page }) => {
    const agentName = `E2E FinanceBot ${Date.now()}`;

    // 1. Register FinanceBot.
    await page.goto("/agents/new");
    await page.getByLabel("Agent name").fill(agentName);
    await page.getByLabel("Agent type").fill("automation");
    await page.getByLabel("Purpose").fill("Financial reporting");
    await page.getByLabel("Criticality").selectOption("critical");
    await page.getByLabel("Data classification").fill("financial");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}/);
    const agentId = page.url().split("/agents/")[1];

    // 2. SHOULD — the approved contract: financial reporting on Snowflake
    // only. The publish form lives inside a collapsed <details>, whose
    // <summary> text matches its own submit button's text, so both are
    // scoped to this one <details> block by element type to stay unambiguous.
    const contractDetails = page.locator("details", { hasText: "Publish new contract version" });
    await contractDetails.locator("summary").click();
    await contractDetails.getByLabel("Purpose").fill("Financial reporting");
    await contractDetails.getByLabel("Approved applications (comma-separated)").fill("Snowflake");
    await contractDetails.getByLabel("Approved data (comma-separated)").fill("financial reporting");
    await contractDetails.getByLabel("Approved actions (comma-separated)").fill("READ, REPORT");
    await contractDetails.locator('button[type="submit"]').click();
    await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();

    // 3. CAN — FinanceBot's actual entitlement includes CustomerDB, which
    // is NOT "financial reporting" data (seeded directly; see module doc).
    const tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    await seedFinanceBotAccess(tenantId, agentId);

    // 4. DID — a real runtime event: FinanceBot reading Snowflake CustomerDB.
    await page.goto(`/runtime/agents/${agentId}`);
    await page.getByLabel("Application").fill("Snowflake");
    await page.getByLabel("Resource").fill("CustomerDB");
    await page.getByLabel("Action").fill("read");
    await page.getByLabel("Data classification").fill("customer_data");
    await page.getByRole("button", { name: "Submit event", exact: true }).click();
    await expect(page).toHaveURL(`/runtime/agents/${agentId}`);

    // 5. The comparison surfaces SHOULD/CAN/DID and at least one deviation.
    await expect(page.getByText(/Snowflake:financial reporting/)).toBeVisible();
    await expect(page.getByText(/Snowflake:CustomerDB_READ/)).toBeVisible();
    await expect(page.getByText(/Snowflake:CustomerDB(?!_)/)).toBeVisible();
    await expect(page.getByText(/excessive access|behavioral violation/)).toBeVisible();

    // 6. Risk evaluation generates the excessive-access finding with
    // evidence and a removal recommendation.
    await page.goto(`/risk/agents/${agentId}`);
    await page.getByRole("button", { name: "Run risk evaluation now" }).click();
    await expect(page).toHaveURL(`/risk/agents/${agentId}`);

    const findingHeading = page.getByRole("heading", { level: 3, name: `${agentName} has effective access beyond its approved contract` });
    await expect(findingHeading).toBeVisible();
    const findingItem = page.locator("li", { has: findingHeading });
    await expect(findingItem.getByText(/Remove the following entitlement\(s\).*CustomerDB_READ/)).toBeVisible();

    // 7. A human administrator initiates remediation.
    await findingItem.getByRole("button", { name: "Request remediation" }).click();
    const remediateDialog = page.getByRole("dialog", { name: "Request remediation" });
    await remediateDialog.getByRole("button", { name: "Request remediation" }).click();
    await expect(remediateDialog.getByText(/Done\.|Failed/)).toBeVisible();
    await remediateDialog.getByRole("button", { name: "Close" }).click();

    // 8. The unauthorized access is actually removed.
    await page.goto(`/access/agents/${agentId}`);
    const grantRow = page.getByRole("row", { name: /CustomerDB_READ/ });
    await grantRow.getByRole("button", { name: "Revoke" }).click();
    const revokeDialog = page.getByRole("dialog", { name: "Revoke access grant" });
    await revokeDialog.getByRole("button", { name: "Revoke access" }).click();
    await expect(revokeDialog.getByText("Done.")).toBeVisible();
    await revokeDialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("0 grants")).toBeVisible();

    // 9. Re-evaluate, then resolve the finding now that its evidence is gone.
    await page.goto(`/risk/agents/${agentId}`);
    await page.getByRole("button", { name: "Run risk evaluation now" }).click();
    await expect(page).toHaveURL(`/risk/agents/${agentId}`);

    const resolvedFindingItem = page.locator("li", { has: page.getByRole("heading", { level: 3, name: `${agentName} has effective access beyond its approved contract` }) });
    await resolvedFindingItem.locator('select[name="resolutionType"]').selectOption("verified_fixed");
    await resolvedFindingItem.getByRole("button", { name: "Resolve", exact: true }).click();

    await expect(page.getByText(/an unexpected error occurred/i)).not.toBeVisible();
    await expect(resolvedFindingItem.getByText("resolved")).toBeVisible();
  });
});
