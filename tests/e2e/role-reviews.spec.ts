import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFile, TEST_USERS, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * COMPLIANCE-P0-11 — access reviews of WonderID's own role assignments.
 * A disposable privileged role is given to the requester directly, and a
 * standard one through a group. A campaign over role assignments lists
 * both (privileged first, with where each comes from), sends them to the
 * named reviewer, never lets a member certify their own role, and a revoke
 * removes the direct role, or the member from the group, at once.
 */

const stamp = Date.now();
const privRole = `E2E RR priv ${stamp}`;
const stdRole = `E2E RR std ${stamp}`;
let tenantId: string;
let requesterId: string;
let iamId: string;
let groupId: string;

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function userId(email: string): Promise<string> {
  const { data } = await db().from("users").select("id").eq("email", email).single();
  return data!.id as string;
}

async function roleId(name: string): Promise<string> {
  const { data } = await db().from("roles").select("id").eq("tenant_id", tenantId).eq("name", name).single();
  return data!.id as string;
}

async function launch(request: APIRequestContext, name: string, scope: Record<string, unknown>): Promise<string> {
  const res = await request.post("/api/v1/compliance/campaigns", { data: { name, scopeType: "role_assignments", scope, cadence: "one_time", reviewerId: iamId } });
  expect(res.status(), await res.text()).toBe(200);
  const id = (await res.json()).data.id as string;
  await expect
    .poll(async () => (await db().from("certification_campaigns").select("build_status").eq("id", id).single()).data?.build_status, { timeout: 60_000 })
    .toBe("ready");
  return id;
}

type ItemRow = { id: string; reviewer_id: string; role_id: string | null; role_source: string | null; group_id: string | null; identity_id: string | null; snapshot: { role: { name: string; privileged: boolean; source: string; group: { name: string } | null } } };

async function itemsOf(campaignId: string): Promise<ItemRow[]> {
  const { data } = await db().from("certification_items").select("id, reviewer_id, role_id, role_source, group_id, identity_id, snapshot").eq("tenant_id", tenantId).eq("campaign_id", campaignId).limit(5000);
  return (data ?? []) as ItemRow[];
}

const decide = (ctx: APIRequestContext, id: string, decision: string) => ctx.post(`/api/v1/compliance/items/${id}/decisions`, { data: { decision, justification: "COMPLIANCE-P0-11 review" } });

test.describe.serial("reviews of WonderID role assignments", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async ({ request }) => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    requesterId = await userId(TEST_USERS.requester.email);
    iamId = await userId(TEST_USERS.iamAdminOne.email);
    expect((await request.post("/api/v1/roles", { data: { name: privRole, description: "Privileged role under review", permissions: ["agent.delete"] } })).status()).toBe(201);
    expect((await request.post("/api/v1/roles", { data: { name: stdRole, description: "Standard role under review", permissions: ["agent.read"] } })).status()).toBe(201);
    expect((await request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: privRole } })).status()).toBe(200);
    const group = await request.post("/api/v1/groups", { data: { name: `E2E RR group ${stamp}` } });
    expect(group.status(), await group.text()).toBe(201);
    groupId = (await group.json()).data.id as string;
    expect((await request.post(`/api/v1/groups/${groupId}/members`, { data: { userId: requesterId } })).status()).toBeLessThan(300);
    expect((await request.post(`/api/v1/groups/${groupId}/roles`, { data: { role: stdRole } })).status()).toBe(201);
  });

  test.afterAll(async () => {
    await db().from("group_members").delete().eq("tenant_id", tenantId).eq("group_id", groupId);
    await db().from("group_roles").delete().eq("tenant_id", tenantId).eq("group_id", groupId);
    await db().from("groups").delete().eq("tenant_id", tenantId).eq("id", groupId);
    for (const name of [privRole, stdRole]) {
      const { data: role } = await db().from("roles").select("id").eq("tenant_id", tenantId).eq("name", name).maybeSingle();
      if (role) {
        await db().from("user_roles").delete().eq("role_id", role.id);
        await db().from("roles").delete().eq("id", role.id);
      }
    }
  });

  test("a campaign lists each role a member holds, directly or through a group, privileged first", async ({ request }) => {
    test.setTimeout(120_000);
    const campaignId = await launch(request, `E2E RR all ${stamp}`, {});
    const items = await itemsOf(campaignId);
    const priv = items.find((i) => i.role_id === null ? false : i.snapshot.role.name === privRole)!;
    const std = items.find((i) => i.snapshot.role.name === stdRole)!;
    expect(priv).toMatchObject({ role_source: "direct", group_id: null, reviewer_id: iamId });
    expect(priv.snapshot.role.privileged).toBe(true);
    expect(std).toMatchObject({ role_source: "group", group_id: groupId, reviewer_id: iamId });
    expect(std.snapshot.role).toMatchObject({ privileged: false, source: "group", group: { name: `E2E RR group ${stamp}` } });
    // Every item is about a person, never an automation credential's backing member.
    const { data: bots } = await db().from("tenant_memberships").select("user_id").eq("tenant_id", tenantId).eq("account_type", "automation");
    const { data: botIdentities } = await db().from("identities").select("id").eq("tenant_id", tenantId).in("user_id", (bots ?? []).map((b) => b.user_id as string));
    const botIds = new Set((botIdentities ?? []).map((b) => b.id as string));
    expect(items.every((i) => i.identity_id && !botIds.has(i.identity_id))).toBe(true);
  });

  test("privileged only: only privileged roles", async ({ request }) => {
    test.setTimeout(120_000);
    const items = await itemsOf(await launch(request, `E2E RR priv ${stamp}`, { privilegedOnly: true }));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.snapshot.role.privileged)).toBe(true);
    expect(items.some((i) => i.snapshot.role.name === privRole)).toBe(true);
    expect(items.some((i) => i.snapshot.role.name === stdRole)).toBe(false);
  });

  test("the reviewer certifies or revokes; nobody certifies their own role; a revoke removes it at once", async ({ request, browser }) => {
    test.setTimeout(120_000);
    const campaignId = await launch(request, `E2E RR decide ${stamp}`, {});
    const items = await itemsOf(campaignId);
    const priv = items.find((i) => i.snapshot.role.name === privRole)!;
    const std = items.find((i) => i.snapshot.role.name === stdRole)!;
    const { data: iamIdentity } = await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", iamId).eq("identity_type", "HUMAN").single();
    const own = items.find((i) => i.identity_id === iamIdentity!.id);
    const adminIdentity = (await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", await userId(TEST_USERS.adminOne.email)).eq("identity_type", "HUMAN").single()).data!.id as string;
    const other = items.find((i) => i.identity_id === adminIdentity)!;

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await decide(ro.request, priv.id, "revoke")).status()).toBe(403);
    await ro.close();

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    if (own) {
      const self = await decide(iam.request, own.id, "approve");
      expect(self.status()).toBe(409);
      expect((await self.json()).error.code).toBe("SELF_CERTIFICATION");
    }
    expect((await decide(iam.request, other.id, "approve")).status()).toBe(200);

    const r1 = await decide(iam.request, priv.id, "revoke");
    expect(r1.status(), await r1.text()).toBe(200);
    const { count: direct } = await db().from("user_roles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("user_id", requesterId).eq("role_id", await roleId(privRole));
    expect(direct).toBe(0);

    const r2 = await decide(iam.request, std.id, "revoke");
    expect(r2.status(), await r2.text()).toBe(200);
    const { count: member } = await db().from("group_members").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("group_id", groupId).eq("user_id", requesterId);
    expect(member).toBe(0);
    await iam.close();

    const { data: audit } = await db().from("audit_logs").select("action, object_id").eq("tenant_id", tenantId).in("object_id", [priv.id, std.id, other.id]);
    const actions = (audit ?? []).map((a) => `${a.action}:${a.object_id}`);
    expect(actions).toEqual(expect.arrayContaining([`compliance.access_revoked:${priv.id}`, `compliance.access_revoked:${std.id}`, `compliance.access_certified:${other.id}`]));

    // Another organization sees none of these items.
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const theirs = await two.request.get(`/api/v1/compliance/campaigns/${campaignId}/items`);
    expect(theirs.status()).toBe(200);
    expect((await theirs.json()).data).toEqual([]);
    expect((await decide(two.request, other.id, "approve")).status()).toBe(404);
    await two.close();
  });

  test("part 2: an exception keeps a direct role until a date; defer moves the due date; escalate goes to whoever launched the campaign", async ({ request, browser }) => {
    test.setTimeout(120_000);
    // The previous test removed both; give them back.
    expect((await request.post(`/api/v1/users/${requesterId}/roles`, { data: { role: privRole } })).status()).toBe(200);
    expect((await request.post(`/api/v1/groups/${groupId}/members`, { data: { userId: requesterId } })).status()).toBeLessThan(300);
    const campaignId = await launch(request, `E2E RR part2 ${stamp}`, {});
    const items = await itemsOf(campaignId);
    const priv = items.find((i) => i.snapshot.role.name === privRole)!;
    const std = items.find((i) => i.snapshot.role.name === stdRole)!;
    const adminId = await userId(TEST_USERS.adminOne.email);
    const adminIdentity = (await db().from("identities").select("id").eq("tenant_id", tenantId).eq("user_id", adminId).eq("identity_type", "HUMAN").single()).data!.id as string;
    const others = items.filter((i) => i.identity_id === adminIdentity);
    expect(others.length).toBeGreaterThan(0);

    const iam = await browser.newContext({ storageState: authFile("iamAdminOne") });
    const decideUntil = (id: string, decision: string, days: number) =>
      iam.request.post(`/api/v1/compliance/items/${id}/decisions`, { data: { decision, justification: "COMPLIANCE-P0-10 part 2", until: new Date(Date.now() + days * 86_400_000).toISOString() } });

    // Exception: at most 90 days; a direct role then ends on that date.
    expect((await decideUntil(priv.id, "exception", 120)).status()).toBe(400);
    const kept = await decideUntil(priv.id, "exception", 30);
    expect(kept.status(), await kept.text()).toBe(200);
    expect((await kept.json()).data.until).toBeTruthy();
    const { data: role } = await db().from("user_roles").select("expires_at").eq("tenant_id", tenantId).eq("user_id", requesterId).eq("role_id", await roleId(privRole)).single();
    expect(Math.abs(new Date(role!.expires_at as string).getTime() - (Date.now() + 30 * 86_400_000))).toBeLessThan(120_000);
    // A role that comes from a group cannot end for one person.
    const group = await decideUntil(std.id, "exception", 30);
    expect(group.status()).toBe(409);
    expect((await group.json()).error.code).toBe("GROUP_ROLE");

    // Defer: still open, due later.
    const deferred = await decideUntil(std.id, "defer", 7);
    expect(deferred.status(), await deferred.text()).toBe(200);
    const { data: stdRow } = await db().from("certification_items").select("status, due_date").eq("id", std.id).single();
    expect(stdRow!.status).toBe("pending");
    expect(Math.abs(new Date(stdRow!.due_date as string).getTime() - (Date.now() + 7 * 86_400_000))).toBeLessThan(120_000);
    expect((await decideUntil(std.id, "defer", 45)).status()).toBe(400);

    // Escalate: to whoever launched the campaign (adminOne), who cannot escalate it further.
    const escalated = await iam.request.post(`/api/v1/compliance/items/${others[0].id}/decisions`, { data: { decision: "escalate", justification: "Needs the campaign owner" } });
    expect(escalated.status(), await escalated.text()).toBe(200);
    const { data: escRow } = await db().from("certification_items").select("status, reviewer_id, escalated_to").eq("id", others[0].id).single();
    expect(escRow).toMatchObject({ status: "pending", reviewer_id: adminId, escalated_to: adminId });
    await iam.close();
    const again = await request.post(`/api/v1/compliance/items/${others[0].id}/decisions`, { data: { decision: "escalate", justification: "again" } });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe("NO_ESCALATION_TARGET");
  });
});
