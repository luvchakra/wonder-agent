import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { authFile, TENANT_ONE } from "./support/testUsers";
import { getTenantIdBySlug } from "./support/seedFinanceBotAccess";

/**
 * INTEGRATION-P0-22 slice 3 — an identity provider pushes people to
 * WonderID over SCIM 2.0, against the real app and database:
 * - the receiver needs the connection's secret as a bearer token;
 * - create, find by userName, deactivate, replace and delete follow RFC 7644,
 *   with SCIM errors (uniqueness, unsupported filters);
 * - each pushed user lands in the connection's staging, and the identity
 *   source reading the connection takes it in;
 * - a deleted user is marked missing, never erased.
 */

const stamp = Date.now();
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const email = `e2e-scim-${stamp}@example.test`;
let tenantId = "";
let connectionId = "";
let secret = "";
let userId = "";
let scim: APIRequestContext;

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

async function personByEmail(request: APIRequestContext) {
  const rows = (await (await request.get(`/api/v1/identities?type=HUMAN&q=${encodeURIComponent(email)}`)).json()).data as { id: string }[];
  if (rows.length !== 1) return null;
  return (await (await request.get(`/api/v1/identities/${rows[0].id}`)).json()).data as { id: string; status: string; department: string | null; title: string | null };
}

test.describe.serial("users pushed over SCIM", () => {
  test.use({ storageState: authFile("adminOne") });

  test.beforeAll(async ({ baseURL }) => {
    tenantId = await getTenantIdBySlug(TENANT_ONE.slug);
    scim = await playwrightRequest.newContext({ baseURL });
  });

  test.afterAll(async () => {
    await scim?.dispose();
  });

  test("setup: a SCIM connection with a receiving secret, read by an identity source", async ({ request }) => {
    const connected = await request.post("/api/v1/integrations/connectors/connect", { data: { origin: "builtin", key: "scim-inbound", name: `E2E SCIM ${stamp}`, settings: {}, secret: {} } });
    expect(connected.status(), await connected.text()).toBe(201);
    connectionId = (await connected.json()).data.integration.id;
    const rotated = await request.post(`/api/v1/integrations/${connectionId}/receiver-secret`);
    expect(rotated.status()).toBe(201);
    secret = (await rotated.json()).data.secret;
    const source = await request.post("/api/v1/integrations/identity-sources", {
      data: {
        name: `E2E SCIM source ${stamp}`,
        template: "integration",
        integrationId: connectionId,
        authoritative: true,
        priority: 10,
        // A source updates only the fields it owns.
        authoritativeFields: ["department", "title", "status"],
        attributeMappings: [
          // The id WonderID assigned; the sender's own externalId is kept in the record too.
          { source: "normalized.externalId", target: "externalId" },
          { source: "normalized.displayName", target: "displayName" },
          { source: "normalized.email", target: "email" },
          { source: "normalized.department", target: "department" },
          { source: "normalized.title", target: "title" },
          { source: "normalized.status", target: "status" },
        ],
      },
    });
    expect(source.status(), await source.text()).toBe(201);
  });

  test("the receiver needs the connection's secret, and answers in SCIM", async () => {
    const none = await scim.get(`/api/connect/v1/${connectionId}/scim/v2/Users`);
    expect(none.status()).toBe(401);
    expect(none.headers()["content-type"]).toContain("application/scim+json");
    expect((await none.json()).schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
    const wrong = await scim.get(`/api/connect/v1/${connectionId}/scim/v2/Users`, { headers: { Authorization: "Bearer wr_wrong" } });
    expect(wrong.status()).toBe(401);
    const config = await scim.get(`/api/connect/v1/${connectionId}/scim/v2/ServiceProviderConfig`, { headers: { Authorization: `Bearer ${secret}` } });
    expect(config.status()).toBe(200);
    expect((await config.json()).patch).toEqual({ supported: true });
    // Another connection id: nothing, the same as no connection at all.
    expect((await scim.get(`/api/connect/v1/00000000-0000-4000-8000-000000000000/scim/v2/Users`, { headers: { Authorization: `Bearer ${secret}` } })).status()).toBe(404);
  });

  test("a pushed user is created, found by userName, and taken in as a person", async ({ request }) => {
    test.setTimeout(90_000);
    const auth = { Authorization: `Bearer ${secret}` };
    const created = await scim.post(`/api/connect/v1/${connectionId}/scim/v2/Users`, {
      headers: auth,
      data: {
        schemas: [USER, ENTERPRISE],
        userName: email,
        externalId: `okta-${stamp}`,
        name: { givenName: "Scim", familyName: `Person ${stamp}` },
        displayName: `E2E SCIM Person ${stamp}`,
        emails: [{ value: email, primary: true }],
        active: true,
        id: "chosen-by-sender",
        [ENTERPRISE]: { department: "Finance" },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const body = await created.json();
    userId = body.id;
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.meta.location).toContain(`/scim/v2/Users/${userId}`);

    const again = await scim.post(`/api/connect/v1/${connectionId}/scim/v2/Users`, { headers: auth, data: { schemas: [USER], userName: email.toUpperCase() } });
    expect(again.status()).toBe(409);
    expect((await again.json()).scimType).toBe("uniqueness");

    const found = await scim.get(`/api/connect/v1/${connectionId}/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`, { headers: auth });
    expect((await found.json())).toMatchObject({ totalResults: 1, Resources: [{ id: userId }] });
    const unsupported = await scim.get(`/api/connect/v1/${connectionId}/scim/v2/Users?filter=${encodeURIComponent('userName sw "e2e"')}`, { headers: auth });
    expect((await unsupported.json()).scimType).toBe("invalidFilter");

    await expect.poll(async () => (await personByEmail(request))?.department ?? null, { timeout: 60_000 }).toBe("Finance");
  });

  test("deactivating and replacing a user change the person", async ({ request }) => {
    test.setTimeout(90_000);
    const auth = { Authorization: `Bearer ${secret}` };
    const off = await scim.patch(`/api/connect/v1/${connectionId}/scim/v2/Users/${userId}`, { headers: auth, data: { schemas: [PATCH], Operations: [{ op: "replace", path: "active", value: false }] } });
    expect(off.status(), await off.text()).toBe(200);
    expect((await off.json()).active).toBe(false);
    await expect.poll(async () => (await personByEmail(request))?.status ?? null, { timeout: 60_000 }).toBe("disabled");

    const replaced = await scim.put(`/api/connect/v1/${connectionId}/scim/v2/Users/${userId}`, {
      headers: auth,
      data: { schemas: [USER], userName: email, displayName: `E2E SCIM Person ${stamp}`, emails: [{ value: email }], title: "Controller", active: true },
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
    await expect.poll(async () => (await personByEmail(request))?.title ?? null, { timeout: 60_000 }).toBe("Controller");
  });

  test("a deleted user is marked missing at the source, never erased", async () => {
    const auth = { Authorization: `Bearer ${secret}` };
    const gone = await scim.delete(`/api/connect/v1/${connectionId}/scim/v2/Users/${userId}`, { headers: auth });
    expect(gone.status()).toBe(204);
    expect((await scim.get(`/api/connect/v1/${connectionId}/scim/v2/Users/${userId}`, { headers: auth })).status()).toBe(404);
    const { data } = await db().from("integration_objects").select("missing_at_source_at, normalized").eq("tenant_id", tenantId).eq("integration_id", connectionId).eq("external_id", userId).single();
    expect(data?.missing_at_source_at).not.toBeNull();
    const { data: audit } = await db().from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("object_id", connectionId).eq("action", "integration.scim_received");
    expect((audit ?? []).map((a) => (a.metadata as { operation: string }).operation).sort()).toEqual(["create", "delete", "patch", "replace"]);
    // The audit names the resource, never the person.
    expect(JSON.stringify(audit)).not.toContain(email);
  });
});
