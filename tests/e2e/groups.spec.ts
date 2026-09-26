import { test, expect } from "@playwright/test";
import { authFile, TEST_USERS } from "./support/testUsers";
import { getSeededUserId } from "./support/seedTestData";

/**
 * FOUNDATION-P0-26 — groups against the real app and database:
 * - an administrator creates a group, gives it a role and adds a person
 *   through the screens, and the role grants real access: the member can
 *   read reports (report.read), loses it when removed from the group, and gets it
 *   back when added again; deleting the group takes it away for good;
 * - the member's user page shows the group and "Role (via Group)"
 *   provenance; the users list filters by group; the role's page lists
 *   the group, and the role cannot be deleted while a group carries it;
 * - no escalation through groups: nobody adds themselves, a member cannot
 *   give their own group roles, and adding people to a group that carries
 *   roles needs role assignment;
 * - another organization sees none of it and cannot use it;
 * - a read-only member cannot open the screen.
 */

const stamp = Date.now().toString(36);
const groupName = `E2E Reporting Team ${stamp}`;
const roleName = `E2E Group Reports ${stamp}`;
let groupId = "";
let roleId = "";

test.describe.serial("groups", () => {
  test.describe.configure({ timeout: 90_000 });

  test("an administrator creates a group, gives it a role and adds a person", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await ctx.newPage();
    const created = await page.request.post("/api/v1/roles", {
      data: { name: roleName, description: "Report access for a group", permissions: ["report.read", "agent.read"] },
    });
    expect(created.status()).toBe(201);
    roleId = (await created.json()).data.id;

    await page.goto("/settings/groups");
    await expect(page.getByRole("heading", { name: "Groups", level: 1 })).toBeVisible();
    await page.getByLabel("Group name").fill(groupName);
    await page.getByLabel("Description").fill("People who read the organization's reports.");
    await page.getByRole("button", { name: "Create group" }).click();
    await expect(page).toHaveURL(/\/settings\/groups\/[0-9a-f-]{36}\?created=1/, { timeout: 30_000 });
    groupId = page.url().split("/settings/groups/")[1]!.split("?")[0]!;
    await expect(page.getByText(`${groupName} was created.`)).toBeVisible();

    await page.getByLabel("Give the group a role").selectOption({ label: roleName });
    await page.getByRole("button", { name: "Assign role" }).click();
    await expect(page.getByText("Role given to the group.")).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("Add a person").selectOption(await getSeededUserId(TEST_USERS.requester.email));
    await page.getByRole("button", { name: "Add to group" }).click();
    await expect(page.getByText("Added. They get the group's roles on their next request.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Members (1)" })).toBeVisible();
    await ctx.close();
  });

  test("the group's role grants real access, and leaving the group takes it away", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const adminPage = await admin.newPage();
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const requesterPage = await requester.newPage();
    const requesterId = await getSeededUserId(TEST_USERS.requester.email);
    const probe = async () => (await requesterPage.request.get("/api/v1/reports")).status();

    expect(await probe()).toBe(200);

    // Provenance on the member's page, and the users list's group filter.
    await adminPage.goto(`/settings/users/${requesterId}`);
    await expect(adminPage.getByRole("link", { name: groupName })).toBeVisible();
    await adminPage.goto(`/settings/users/${requesterId}?tab=permissions`);
    await expect(adminPage.getByText(`${roleName} (via ${groupName})`).first()).toBeVisible();
    await adminPage.goto(`/settings/users?group=${groupId}`);
    await expect(adminPage.getByRole("link", { name: new RegExp(TEST_USERS.requester.email) })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: new RegExp(TEST_USERS.adminOne.email) })).toHaveCount(0);

    // The role's page lists the group, and the role cannot be deleted while a group carries it.
    await adminPage.goto(`/settings/roles/${roleId}?tab=groups`);
    await expect(adminPage.getByRole("link", { name: groupName })).toBeVisible();
    const del = await adminPage.request.delete(`/api/v1/roles/${roleId}`);
    expect(del.status()).toBe(409);
    expect((await del.json()).error.code).toBe("ROLE_IN_USE");

    expect((await adminPage.request.delete(`/api/v1/groups/${groupId}/members/${requesterId}`)).status()).toBe(200);
    expect(await probe()).toBe(403);
    expect((await adminPage.request.post(`/api/v1/groups/${groupId}/members`, { data: { userId: requesterId } })).status()).toBe(201);
    expect(await probe()).toBe(200);
    // An inactive role grants nothing through a group either.
    expect((await adminPage.request.post(`/api/v1/roles/${roleId}/status`, { data: { status: "inactive" } })).status()).toBe(200);
    expect(await probe()).toBe(403);
    expect((await adminPage.request.post(`/api/v1/roles/${roleId}/status`, { data: { status: "active" } })).status()).toBe(200);
    expect(await probe()).toBe(200);
    await admin.close();
    await requester.close();
  });

  test("no escalation through groups", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const adminPage = await admin.newPage();
    const adminId = await getSeededUserId(TEST_USERS.adminOne.email);

    // Nobody adds themselves.
    const self = await adminPage.request.post(`/api/v1/groups/${groupId}/members`, { data: { userId: adminId } });
    expect(self.status()).toBe(403);
    expect((await self.json()).error.code).toBe("SELF_ESCALATION");

    // Adding people to a group that carries roles needs role assignment:
    // the Identity Administrator manages members but does not assign roles.
    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const iamPage = await iam.newPage();
    const readOnlyId = await getSeededUserId(TEST_USERS.readOnly.email);
    expect((await iamPage.request.post(`/api/v1/groups/${groupId}/members`, { data: { userId: readOnlyId } })).status()).toBe(403);

    // A member cannot give their own group roles: the Identity
    // Administrator puts the tenant administrator in a group without roles…
    const empty = await adminPage.request.post("/api/v1/groups", { data: { name: `E2E Empty ${stamp}` } });
    expect(empty.status()).toBe(201);
    const emptyId = (await empty.json()).data.id as string;
    expect((await iamPage.request.post(`/api/v1/groups/${emptyId}/members`, { data: { userId: adminId } })).status()).toBe(201);
    // …and the administrator, now a member, is refused.
    const own = await adminPage.request.post(`/api/v1/groups/${emptyId}/roles`, { data: { role: "TENANT_SUPER_ADMIN" } });
    expect(own.status()).toBe(403);
    expect((await own.json()).error.code).toBe("SELF_ESCALATION");
    // The Identity Administrator cannot give roles at all.
    expect((await iamPage.request.post(`/api/v1/groups/${emptyId}/roles`, { data: { role: "TENANT_SUPER_ADMIN" } })).status()).toBe(403);
    expect((await adminPage.request.delete(`/api/v1/groups/${emptyId}`)).status()).toBe(200);
    await iam.close();
    await admin.close();
  });

  test("other organizations see nothing, and a read-only member cannot open the screen", async ({ browser }) => {
    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    const otherPage = await other.newPage();
    expect((await otherPage.request.get(`/api/v1/groups/${groupId}`)).status()).toBe(404);
    expect(JSON.stringify((await (await otherPage.request.get("/api/v1/groups")).json()).data)).not.toContain(groupName);
    const tenantTwoMember = await getSeededUserId(TEST_USERS.multiOrg.email);
    expect((await otherPage.request.post(`/api/v1/groups/${groupId}/members`, { data: { userId: tenantTwoMember } })).status()).toBe(404);
    expect((await otherPage.request.delete(`/api/v1/groups/${groupId}`)).status()).toBe(404);
    await other.close();

    // Someone outside this organization cannot be added to its group.
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const adminPage = await admin.newPage();
    const tenantTwoOnly = await getSeededUserId(TEST_USERS.adminTwo.email);
    expect((await adminPage.request.post(`/api/v1/groups/${groupId}/members`, { data: { userId: tenantTwoOnly } })).status()).toBe(404);
    await admin.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const roPage = await ro.newPage();
    await roPage.goto("/settings/groups");
    await expect(roPage).toHaveURL(/\/settings$/);
    await ro.close();
  });

  test("deleting the group takes its roles away from its members", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: authFile("adminOne") });
    const page = await admin.newPage();
    const requester = await browser.newContext({ storageState: authFile("requester") });
    const requesterPage = await requester.newPage();
    await page.goto(`/settings/groups/${groupId}`);
    await page.getByRole("button", { name: "Delete group" }).click();
    await page.getByRole("button", { name: "Delete group" }).click();
    await expect(page).toHaveURL(/\/settings\/groups\?deleted=1/, { timeout: 30_000 });
    await expect(page.getByText("The group was deleted.")).toBeVisible();
    expect((await requesterPage.request.get("/api/v1/reports")).status()).toBe(403);
    expect((await page.request.delete(`/api/v1/roles/${roleId}`)).status()).toBe(200);
    await admin.close();
    await requester.close();
  });
});
