import { test, expect } from "@playwright/test";
import { authFile, TEST_USERS } from "./support/testUsers";
import { getSeededUserId } from "./support/seedTestData";

/**
 * FOUNDATION-P0-25 — system and custom roles against the real app and
 * database:
 * - the Roles screen lists the system roles (including the specification's
 *   new ones) read-only, with a per-module permission summary and a copy;
 * - an administrator creates a custom role through the wizard, and it
 *   grants real access: a requester holding it can use compliance.read,
 *   loses it when the role is deactivated, and gets it back on activation;
 * - system roles cannot be changed, custom roles cannot take a system
 *   role's name, a role in use cannot be deleted;
 * - another organization sees none of it and cannot assign it;
 * - a read-only member cannot open the screen.
 */

const stamp = Date.now().toString(36);
const roleName = `E2E Compliance Reviewer ${stamp}`;
let roleId = "";

test.describe.serial("custom roles", () => {
  test.describe.configure({ timeout: 90_000 });

  test("system roles are listed read-only, with a per-module summary", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await ctx.newPage();
    await page.goto("/settings/roles");
    await expect(page.getByRole("heading", { name: "Roles", level: 1 })).toBeVisible();
    for (const r of ["Tenant Administrator", "Agent Administrator", "Runtime Security Administrator", "Governance Administrator", "Security Analyst"]) {
      await expect(page.getByRole("link", { name: r, exact: true })).toBeVisible();
    }
    await page.getByRole("link", { name: "Security Administrator", exact: true }).click();
    await expect(page.getByText("System role", { exact: true })).toBeVisible();
    await expect(page.getByText("Permission summary")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit role" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Copy role" })).toBeVisible();
    await ctx.close();
  });

  test("an administrator creates a custom role through the wizard", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await ctx.newPage();
    await page.goto("/settings/roles/new");
    await page.getByLabel("Role name").fill(roleName);
    await page.getByLabel("Description").fill("Reviews certifications and compliance evidence.");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("searchbox", { name: "Search permissions" }).fill("certifications");
    await page.getByRole("checkbox", { name: "View certifications and controls" }).check();
    await page.getByRole("searchbox", { name: "Search permissions" }).fill("");
    await page.getByRole("checkbox", { name: "View AI agents" }).check();
    await page.getByRole("button", { name: "Next" }).click();
    const review = page.getByRole("region", { name: "Review" });
    await expect(review).toContainText(roleName);
    await expect(review).toContainText("View certifications and controls");
    await page.getByRole("button", { name: "Create role" }).click();
    await expect(page).toHaveURL(/\/settings\/roles\/[0-9a-f-]{36}\?saved=created/, { timeout: 30_000 });
    roleId = page.url().split("/settings/roles/")[1]!.split("?")[0]!;
    await expect(page.getByText(`${roleName} was created.`)).toBeVisible();
    await expect(page.getByText("Custom role", { exact: true })).toBeVisible();
    await expect(page.getByText("compliance.read")).toBeVisible();
    await ctx.close();
  });

  test("the custom role grants real access, and deactivating it takes that away", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const adminPage = await admin.newPage();
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const requesterPage = await requester.newPage();
    const requesterId = await getSeededUserId(TEST_USERS.requester.email);
    const probe = async () => (await requesterPage.request.get("/api/v1/compliance/controls")).status();

    expect(await probe()).toBe(403);
    expect((await adminPage.request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: roleName } })).status()).toBe(200);
    expect(await probe()).toBe(200);

    expect((await adminPage.request.post(`/api/v1/roles/${roleId}/status`, { data: { status: "inactive" } })).status()).toBe(200);
    expect(await probe()).toBe(403);
    // An inactive role cannot be handed out either.
    const toReadOnly = await adminPage.request.post(`/api/v1/users/${await getSeededUserId(TEST_USERS.readOnly.email)}/roles`, { data: { role: roleName } });
    expect(toReadOnly.status()).toBe(409);
    expect((await adminPage.request.post(`/api/v1/roles/${roleId}/status`, { data: { status: "active" } })).status()).toBe(200);
    expect(await probe()).toBe(200);

    // In use: it cannot be deleted.
    const del = await adminPage.request.delete(`/api/v1/roles/${roleId}`);
    expect(del.status()).toBe(409);
    expect((await del.json()).error.code).toBe("ROLE_IN_USE");

    // The holder shows on the role's People tab.
    await adminPage.goto(`/settings/roles/${roleId}?tab=people`);
    await expect(adminPage.getByRole("link", { name: new RegExp(TEST_USERS.requester.email) })).toBeVisible();

    expect((await adminPage.request.delete(`/api/v1/users/${requesterId}/roles?role=${encodeURIComponent(roleName)}`)).status()).toBe(200);
    expect(await probe()).toBe(403);
    await admin.close();
    await requester.close();
  });

  test("system roles are protected, reserved names refused, other organizations see nothing", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await admin.newPage();
    const roles = (await (await page.request.get("/api/v1/roles")).json()).data as { id: string; name: string; custom: boolean }[];
    const system = roles.find((r) => r.name === "SECURITY_ADMIN")!;
    const patch = await page.request.patch(`/api/v1/roles/${system.id}`, { data: { name: "Hacked", description: "x", permissions: ["agent.read"] } });
    expect(patch.status()).toBe(403);
    expect((await patch.json()).error.code).toBe("SYSTEM_ROLE_PROTECTED");
    const reserved = await page.request.post("/api/v1/roles", { data: { name: "Auditor", description: "x", permissions: ["agent.read"] } });
    expect(reserved.status()).toBe(400);
    expect((await reserved.json()).error.fields.name).toMatch(/system role/);
    await admin.close();

    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const otherPage = await other.newPage();
    expect((await otherPage.request.get(`/api/v1/roles/${roleId}`)).status()).toBe(404);
    const otherList = JSON.stringify((await (await otherPage.request.get("/api/v1/roles")).json()).data);
    expect(otherList).not.toContain(roleName);
    const tenantTwoMember = await getSeededUserId(TEST_USERS.multiOrg.email);
    expect((await otherPage.request.post(`/api/v1/users/${tenantTwoMember}/roles`, { data: { role: roleName } })).status()).toBe(400);
    await other.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const roPage = await ro.newPage();
    await roPage.goto("/settings/roles");
    await expect(roPage).toHaveURL(/\/settings$/);
    await ro.close();
  });

  test("editing and deleting a custom role nobody holds", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await ctx.newPage();
    await page.goto(`/settings/roles/${roleId}/edit`);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("checkbox", { name: "View reports" }).check();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Save role" }).click();
    await expect(page.getByText("Saved. People who hold the role get the change on their next request.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("report.read")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete role" }).click();
    await expect(page).toHaveURL(/\/settings\/roles\?deleted=1/);
    await expect(page.getByText("The role was deleted.")).toBeVisible();
    await ctx.close();
  });
});
