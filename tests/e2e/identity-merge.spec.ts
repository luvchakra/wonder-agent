import { test, expect, type APIRequestContext } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * IDENTITY-P0-23 — merging two records of the same person, against the real
 * app and database: the duplicate is suggested, the person picks per
 * attribute, the merge moves what the other record had and can be undone;
 * a read-only member and another organization cannot merge.
 */

const stamp = Date.now();
const email = `e2e-merge-${stamp}@e2e.wonderagent.test`;

async function person(request: APIRequestContext, data: Record<string, unknown>): Promise<{ id: string; ref: number }> {
  const res = await request.post("/api/v1/identities", { data: { identityType: "HUMAN", ...data } });
  expect(res.status()).toBe(201);
  const body = (await res.json()).data;
  return { id: body.id, ref: body.ref };
}

let keep = { id: "", ref: 0 };
let other = { id: "", ref: 0 };

test.describe.serial("merging duplicate people", () => {
  test.use({ storageState: authFile("adminOne") });

  test("setup: two records of the same person", async ({ request }) => {
    keep = await person(request, { displayName: `E2E Merge Ada ${stamp}`, email, department: "Finance" });
    other = await person(request, { displayName: `E2E Merge Ada (HR) ${stamp}`, email: email.toUpperCase(), department: "Risk", title: "Analyst" });
  });

  test("the duplicate is suggested, compared and merged with the chosen values; then undone", async ({ page }) => {
    await page.goto(`/identities/${keep.ref}`);
    await expect(page.getByText(`Possible duplicate: E2E Merge Ada (HR) ${stamp}`)).toBeVisible();
    await page.getByRole("link", { name: "Compare and merge" }).click();
    await expect(page.getByRole("heading", { name: `Merge into E2E Merge Ada ${stamp}` })).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: `E2E Merge Ada (HR) ${stamp}` }).getByRole("link", { name: "Compare" }).click();

    // Department differs: take the other's. Title is blank here, so it comes across by itself.
    await page.getByRole("radio", { name: "Risk" }).check();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Merge records" }).click();

    await expect(page.getByText("Merged. The other record's access now belongs to this one.")).toBeVisible();
    await expect(page.getByTestId("identity-merges")).toContainText(`Merged from E2E Merge Ada (HR) ${stamp}`);
    await expect(page.getByText("Risk", { exact: true })).toBeVisible();
    await expect(page.getByText("Analyst", { exact: true })).toBeVisible();

    await page.goto(`/identities/${other.ref}`);
    await expect(page.getByTestId("identity-merges")).toContainText(`Merged into E2E Merge Ada ${stamp}`);

    await page.getByText("Undo the merge").click();
    await page.getByLabel("Why undo it?").fill("Two different people after all");
    await page.getByRole("button", { name: "Undo the merge" }).click();
    await expect(page.getByText("The merge was undone. Both records are back as they were.")).toBeVisible();

    await page.goto(`/identities/${keep.ref}`);
    await expect(page.getByTestId("identity-merges")).toHaveCount(0);
    await expect(page.getByText("Finance", { exact: true })).toBeVisible();
  });

  test("a read-only member sees no merge link and cannot merge", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("readOnly") });
    const page = await ctx.newPage();
    await page.goto(`/identities/${keep.ref}`);
    await expect(page.getByRole("heading", { name: `E2E Merge Ada ${stamp}` })).toBeVisible();
    await expect(page.getByRole("link", { name: /merge/i })).toHaveCount(0);
    await page.goto(`/identities/${keep.ref}/merge?with=${other.ref}`);
    await expect(page.getByRole("button", { name: "Merge records" })).toHaveCount(0);
    await ctx.close();
  });

  test("another organization's administrator finds neither record", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminTwo") });
    const page = await ctx.newPage();
    const res = await page.goto(`/identities/${keep.id}/merge?with=${other.id}`);
    expect(res?.status()).toBe(404);
    await ctx.close();
  });
});
