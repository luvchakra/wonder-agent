import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE, TEST_USERS } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * ACCESS-P0-42 (owner request 2026-10-14) — internal fulfilment task
 * assignment, against the real app and database:
 * - an application's tasks go to the group set for it, and an entitlement
 *   type's to the person set for that type;
 * - any member of the group may claim the group's task; a non-member may not;
 * - the claimer hands the task on with a reason: the claim is released, the
 *   new assignee is recorded, and it is audited;
 * - the workload counts each assignee's tasks;
 * - another organization and a read-only role cannot change who fulfils.
 * Tasks come from a person leaving (WID-C02), which opens one removal per grant.
 */

const stamp = Date.now();
let tenantId = "";
let applicationId = "";
let leaverId = "";
let licenceHolderId = "";
let groupId = "";
let readOnlyUserId = "";
let groupGrantId = "";
let licenceGrantId = "";
let groupTaskId = "";
let licenceTaskId = "";

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db().from(table).insert(row).select("id").single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return data!.id as string;
}

test.describe.serial("fulfilment task assignment", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async () => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    const { data: ro } = await db().from("users").select("id").eq("email", TEST_USERS.readOnly.email).single();
    readOnlyUserId = ro!.id as string;
    leaverId = await insert("identities", { tenant_id: tenantId, identity_type: "HUMAN", display_name: `E2E Assign Leaver ${stamp}`, status: "active", lifecycle_state: "ACTIVE" });
    licenceHolderId = await insert("identities", { tenant_id: tenantId, identity_type: "HUMAN", display_name: `E2E Licence Desk ${stamp}`, status: "active", lifecycle_state: "ACTIVE" });
    applicationId = await insert("applications", { tenant_id: tenantId, name: `e2e-assign-app-${stamp}` });
    groupId = await insert("groups", { tenant_id: tenantId, name: `E2E Fulfilers ${stamp}` });
    const accountId = await insert("accounts", { tenant_id: tenantId, application_id: applicationId, identity_id: leaverId, external_account_ref: `assign-${stamp}` });
    const reader = await insert("entitlements", { tenant_id: tenantId, application_id: applicationId, name: `Reader_${stamp}` });
    const licence = await insert("entitlements", { tenant_id: tenantId, application_id: applicationId, name: `Licence_${stamp}`, entitlement_type: "license" });
    groupGrantId = await insert("access_grants", { tenant_id: tenantId, account_id: accountId, entitlement_id: reader, grant_type: "direct" });
    licenceGrantId = await insert("access_grants", { tenant_id: tenantId, account_id: accountId, entitlement_id: licence, grant_type: "direct" });
  });

  test.afterAll(async () => {
    await db().from("access_fulfilment_tasks").delete().eq("tenant_id", tenantId).eq("application_id", applicationId);
    await db().from("access_grants").delete().in("id", [groupGrantId, licenceGrantId]);
    await db().from("accounts").delete().eq("tenant_id", tenantId).eq("application_id", applicationId);
    await db().from("entitlements").delete().eq("tenant_id", tenantId).eq("application_id", applicationId);
    await db().from("applications").delete().eq("id", applicationId);
    await db().from("groups").delete().eq("id", groupId);
  });

  test("who fulfils is set per application and per entitlement type; others cannot change it", async ({ request, browser }) => {
    const url = `/api/v1/access/applications/${applicationId}/fulfilment-assignments`;
    expect((await request.post(url, { data: { identityId: licenceHolderId, groupId } })).status()).toBe(400);
    expect((await request.post(url, { data: { groupId } })).status()).toBe(200);
    expect((await request.post(url, { data: { entitlementType: "license", identityId: licenceHolderId } })).status()).toBe(200);
    // Setting the same scope again replaces it rather than adding a second.
    expect((await request.post(url, { data: { groupId } })).status()).toBe(200);
    const rows = (await (await request.get(url)).json()).data as { entitlementType: string | null; groupName: string | null; identityName: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.entitlementType === null)).toMatchObject({ groupName: `E2E Fulfilers ${stamp}` });
    expect(rows.find((r) => r.entitlementType === "license")).toMatchObject({ identityName: `E2E Licence Desk ${stamp}` });

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.post(url, { data: { groupId } })).status()).toBe(403);
    await ro.close();
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect(((await (await two.request.get(url)).json()).data as unknown[]).length).toBe(0);
    expect((await two.request.post(url, { data: { groupId } })).status()).toBe(404);
    await two.close();
  });

  test("new tasks go to the group, or to the person set for the entitlement's type", async ({ request }) => {
    const res = await request.post(`/api/v1/identities/${leaverId}/lifecycle`, { data: { toState: "DISABLED", note: "Last day passed" } });
    expect(res.status(), await res.text()).toBe(201);
    const { data: tasks } = await db()
      .from("access_fulfilment_tasks")
      .select("id, removal_grant_id, assignee_identity_id, assignee_group_id, status")
      .eq("tenant_id", tenantId)
      .eq("application_id", applicationId);
    const byGrant = new Map((tasks ?? []).map((t) => [t.removal_grant_id as string, t]));
    expect(byGrant.get(groupGrantId)).toMatchObject({ assignee_group_id: groupId, assignee_identity_id: null, status: "open" });
    expect(byGrant.get(licenceGrantId)).toMatchObject({ assignee_identity_id: licenceHolderId, assignee_group_id: null });
    groupTaskId = byGrant.get(groupGrantId)!.id as string;
    licenceTaskId = byGrant.get(licenceGrantId)!.id as string;
  });

  test("a member of the group may claim its task; before joining, they may not", async ({ browser }) => {
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const claim = () => ro.request.post(`/api/v1/access/fulfilment-tasks/${groupTaskId}`, { data: { action: "claim" } });
    expect((await claim()).status()).toBe(403);
    const { error } = await db().from("group_members").insert({ group_id: groupId, tenant_id: tenantId, user_id: readOnlyUserId });
    expect(error, error?.message).toBeNull();
    const claimed = await claim();
    expect(claimed.status(), await claimed.text()).toBe(200);
    expect((await claimed.json()).data).toMatchObject({ status: "claimed", claimedBy: readOnlyUserId, assigneeGroupName: `E2E Fulfilers ${stamp}` });
    // Not theirs: the licence task belongs to the person set for the type.
    expect((await ro.request.post(`/api/v1/access/fulfilment-tasks/${licenceTaskId}`, { data: { action: "claim" } })).status()).toBe(403);
    await ro.close();
  });

  test("the claimer hands the task on with a reason; the claim is released and audited", async ({ browser }) => {
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const url = `/api/v1/access/fulfilment-tasks/${groupTaskId}/reassign`;
    expect((await ro.request.post(url, { data: { identityId: licenceHolderId } })).status()).toBe(400);
    const moved = await ro.request.post(url, { data: { identityId: licenceHolderId, reason: "Licence desk handles this system" } });
    expect(moved.status(), await moved.text()).toBe(200);
    expect((await moved.json()).data).toMatchObject({
      status: "open",
      claimedBy: null,
      assigneeIdentityId: licenceHolderId,
      assigneeGroupId: null,
      assignmentReason: "Licence desk handles this system",
    });
    // Now neither theirs nor claimed by them: they cannot move it again.
    expect((await ro.request.post(url, { data: { groupId, reason: "back" } })).status()).toBe(403);
    // A task not theirs at all.
    expect((await ro.request.post(`/api/v1/access/fulfilment-tasks/${licenceTaskId}/reassign`, { data: { groupId, reason: "x" } })).status()).toBe(403);
    await ro.close();
    const { data: audit } = await db().from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("object_id", groupTaskId).eq("action", "access.fulfilment_task_reassigned");
    expect(audit?.[0]?.metadata).toMatchObject({ to: { identityId: licenceHolderId, groupId: null }, releasedClaim: true });

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.post(url, { data: { groupId, reason: "x" } })).status()).toBe(404);
    await two.close();
  });

  test("an access manager hands it back to the group; the workload counts each assignee", async ({ request }) => {
    const back = await request.post(`/api/v1/access/fulfilment-tasks/${groupTaskId}/reassign`, { data: { groupId, reason: "Group queue again" } });
    expect(back.status(), await back.text()).toBe(200);
    expect((await request.post(`/api/v1/access/fulfilment-tasks/${groupTaskId}/reassign`, { data: { groupId, reason: "again" } })).status()).toBe(409);
    const load = (await (await request.get("/api/v1/access/fulfilment-tasks/workload")).json()).data as { groupId: string | null; identityId: string | null; open: number; name: string }[];
    expect(load.find((w) => w.groupId === groupId)).toMatchObject({ open: 1, name: `E2E Fulfilers ${stamp}` });
    expect(load.find((w) => w.identityId === licenceHolderId)?.open).toBeGreaterThanOrEqual(1);
  });

  test("the screens show who fulfils and the workload", async ({ page }) => {
    await page.goto("/access/fulfilment?view=all");
    await expect(page.getByText(`group E2E Fulfilers ${stamp}`).first()).toBeVisible();
    await page.getByText("Workload", { exact: true }).click();
    await expect(page.getByText(`E2E Fulfilers ${stamp}`, { exact: true })).toBeVisible();
    await page.goto(`/access/applications/${applicationId}?tab=onboarding`);
    await page.getByText("Fulfilled by", { exact: true }).click();
    await expect(page.getByText(`E2E Fulfilers ${stamp} (group)`).first()).toBeVisible();
  });
});
