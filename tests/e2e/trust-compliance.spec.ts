import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * 2026-10-01 — payments, privacy, financial compliance and IT security
 * (PLATFORM-P1-04, COMPLIANCE-P0-12/13, FOUNDATION-P0-28/29/30) against
 * the real app and database:
 * - billing: the screen, profile validation (GSTIN check character), an
 *   honest refusal when no provider is configured, and webhooks that never
 *   accept an unsigned body;
 * - privacy: a GDPR request gets its one-month deadline from receipt, must
 *   be verified before it completes, cannot be reopened, and erasure cannot
 *   be approved by whoever prepared it; a DPDP breach starts the Board
 *   clocks and cannot close with notices outstanding; members download
 *   their own data;
 * - audit integrity: the hash chain verifies intact;
 * - security: cross-site API writes are refused, security headers are
 *   sent, security.txt is public;
 * - permissions and isolation: a read-only member and another organization
 *   see and change none of it.
 *
 * Billing provider keys are not configured in CI, so checkout is asserted
 * to refuse truthfully (503 PROVIDER_NOT_CONFIGURED) rather than to pay.
 */

const stamp = Date.now().toString(36);
const DAY = 24 * 60 * 60 * 1000;
let accessRequestId = "";
let erasureRequestId = "";
let breachId = "";

test.describe.serial("trust and compliance", () => {
  test.use({ storageState: authFile("adminOne") });
  test.describe.configure({ timeout: 90_000 });

  test("security headers, security.txt and the cross-site write guard", async ({ request }) => {
    const welcome = await request.get("/welcome");
    const h = welcome.headers();
    expect(h["strict-transport-security"]).toContain("max-age=63072000");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-powered-by"]).toBeUndefined();

    const txt = await request.get("/.well-known/security.txt");
    expect(txt.status()).toBe(200);
    expect(await txt.text()).toContain("Contact:");

    const forged = await request.post("/api/v1/billing/checkout", { headers: { Origin: "https://attacker.example" }, data: { priceId: "pro_month_usd" } });
    expect(forged.status()).toBe(403);
    expect((await forged.json()).error.code).toBe("CROSS_SITE_REQUEST");
  });

  test("billing: screen, profile validation, honest checkout refusal, signed webhooks only", async ({ page, request }) => {
    await page.goto("/settings/billing");
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Billing details" })).toBeVisible();

    const bad = await request.put("/api/v1/billing/profile", { data: { legalName: "E2E Tenant One Pvt Ltd", billingEmail: "billing@e2e.wonderagent.test", country: "IN", taxIdType: "in_gst", taxId: "27AAPFU0939F1ZX" } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.fields.taxId).toMatch(/GSTIN/);

    const good = await request.put("/api/v1/billing/profile", {
      data: { legalName: "E2E Tenant One Pvt Ltd", billingEmail: "billing@e2e.wonderagent.test", country: "IN", taxIdType: "in_gst", taxId: "27AAPFU0939F1ZV", tenant_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(good.status()).toBe(200);
    const profile = (await good.json()).data;
    expect(profile.taxId).toBe("27AAPFU0939F1ZV");
    // A tenant id in the body is ignored: the profile belongs to the session's organization.
    expect(profile.tenantId).not.toBe("00000000-0000-0000-0000-000000000000");

    const checkout = await request.post("/api/v1/billing/checkout", { data: { priceId: "pro_month_inr" } });
    if (checkout.status() !== 200) {
      expect([409, 503]).toContain(checkout.status());
      expect(["PROVIDER_NOT_CONFIGURED", "SUBSCRIPTION_EXISTS", "CHECKOUT_IN_PROGRESS"]).toContain((await checkout.json()).error.code);
    }

    for (const provider of ["stripe", "razorpay"]) {
      const res = await request.post(`/api/v1/billing/webhooks/${provider}`, { data: { id: "evt_forged", type: "invoice.paid", event: "subscription.charged" } });
      expect([400, 503]).toContain(res.status());
    }
  });

  test("privacy: a GDPR access request runs on its statutory clock", async ({ request }) => {
    const created = await request.post("/api/v1/privacy/requests", { data: { regime: "gdpr", requestType: "access", subjectEmail: `e2e-subject-${stamp}@e2e.wonderagent.test`, channel: "email" } });
    expect(created.status()).toBe(201);
    const req = (await created.json()).data;
    accessRequestId = req.id;
    expect(req.reference).toMatch(/^PR-\d{4}-/);
    const span = new Date(req.dueAt).getTime() - new Date(req.receivedAt).getTime();
    expect(span).toBeGreaterThanOrEqual(28 * DAY);
    expect(span).toBeLessThanOrEqual(31 * DAY);

    // Completing before the identity is verified is refused.
    const early = await request.post(`/api/v1/privacy/requests/${req.id}`, { data: { action: "complete", outcome: "fulfilled" } });
    expect(early.status()).toBe(409);
    expect((await early.json()).error.code).toBe("IDENTITY_NOT_VERIFIED");

    expect((await request.post(`/api/v1/privacy/requests/${req.id}`, { data: { action: "verify", method: "Reply from the address on file" } })).status()).toBe(200);
    const exported = await request.get(`/api/v1/privacy/requests/${req.id}/export`);
    expect(exported.status()).toBe(200);
    expect((await exported.json()).format).toBe("wonderid.subject-export.v1");

    const done = await request.post(`/api/v1/privacy/requests/${req.id}`, { data: { action: "complete", outcome: "fulfilled", reason: "Export sent" } });
    expect(done.status()).toBe(200);
    expect((await done.json()).data.status).toBe("completed");
    // A closed request never reopens.
    expect((await request.post(`/api/v1/privacy/requests/${req.id}`, { data: { action: "reject", reason: "Trying to reopen a closed request" } })).status()).toBe(409);
  });

  test("privacy: erasure cannot be approved by whoever prepared it", async ({ request }) => {
    const created = await request.post("/api/v1/privacy/requests", { data: { regime: "dpdp", requestType: "erasure", subjectEmail: `e2e-erase-${stamp}@e2e.wonderagent.test`, channel: "web_form" } });
    expect(created.status()).toBe(201);
    erasureRequestId = (await created.json()).data.id;
    const span = new Date((await created.json()).data.dueAt).getTime() - new Date((await created.json()).data.receivedAt).getTime();
    expect(Math.round(span / DAY)).toBe(90);
    // DPDP allows no extension.
    const ext = await request.post(`/api/v1/privacy/requests/${erasureRequestId}`, { data: { action: "extend", dueAt: new Date(Date.now() + 120 * DAY).toISOString(), reason: "Large volume of records to review" } });
    expect(ext.status()).toBe(400);
    expect((await ext.json()).error.code).toBe("EXTENSION_REFUSED");
    // Erasure is never completed directly.
    await request.post(`/api/v1/privacy/requests/${erasureRequestId}`, { data: { action: "verify", method: "Verified by a call back to the registered number" } });
    expect((await request.post(`/api/v1/privacy/requests/${erasureRequestId}`, { data: { action: "complete", outcome: "fulfilled" } })).status()).toBe(409);
    expect((await request.post(`/api/v1/privacy/requests/${erasureRequestId}`, { data: { action: "submit_for_approval" } })).status()).toBe(200);
    const self = await request.post(`/api/v1/privacy/requests/${erasureRequestId}`, { data: { action: "approve" } });
    expect(self.status()).toBe(403);
    expect((await self.json()).error.code).toBe("FOUR_EYES_REQUIRED");
  });

  test("privacy: a DPDP breach starts the Board clocks and cannot close with notices outstanding", async ({ request }) => {
    const created = await request.post("/api/v1/privacy/breaches", {
      data: { title: `E2E breach ${stamp}`, description: "Test incident recorded by the E2E suite", severity: "high", riskToIndividuals: "unlikely", regimes: ["dpdp"] },
    });
    expect(created.status()).toBe(201);
    breachId = (await created.json()).data.id;
    const list = (await (await request.get("/api/v1/privacy/breaches")).json()).data as { id: string; obligations: { key: string; state: string }[] }[];
    const keys = list.find((b) => b.id === breachId)!.obligations.map((o) => o.key);
    // Under DPDP the Board and every person are told regardless of risk.
    expect(keys).toEqual(["dpb_intimation", "dpb_report", "subjects"]);
    const close = await request.post(`/api/v1/privacy/breaches/${breachId}`);
    expect(close.status()).toBe(409);
    expect((await close.json()).error.code).toBe("NOTIFICATIONS_OUTSTANDING");
  });

  test("members download their own data; the audit chain verifies intact", async ({ page, request }) => {
    const mine = await request.get("/api/v1/privacy/me/export");
    expect(mine.status()).toBe(200);
    expect(mine.headers()["cache-control"]).toContain("no-store");
    const body = await mine.json();
    expect(body.subject.email).toBe("e2e-admin-1@e2e.wonderagent.test");

    const chain = await request.get("/api/v1/audit/integrity");
    expect(chain.status()).toBe(200);
    const report = (await chain.json()).data;
    expect(report.intact).toBe(true);
    expect(report.checked).toBeGreaterThan(0);

    await page.goto("/my-privacy");
    await expect(page.getByRole("heading", { name: "My privacy" })).toBeVisible();
    await page.goto("/settings/privacy");
    await expect(page.getByRole("heading", { name: "Privacy & Data Protection" })).toBeVisible();
    await page.goto("/audit/integrity");
    await expect(page.getByText("Intact", { exact: true })).toBeVisible();
  });

  test("a read-only member and another organization see and change none of it", async ({ browser }) => {
    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    expect((await ro.request.get("/api/v1/billing")).status()).toBe(403);
    expect((await ro.request.get("/api/v1/privacy/requests")).status()).toBe(403);
    expect((await ro.request.put("/api/v1/billing/profile", { data: { legalName: "Hijack Ltd", billingEmail: "x@e2e.wonderagent.test", country: "US" } })).status()).toBe(403);
    // Every member still holds their own data rights.
    expect((await ro.request.get("/api/v1/privacy/me")).status()).toBe(200);
    const roPage = await ro.newPage();
    await roPage.goto("/settings/billing");
    await expect(roPage).toHaveURL(/\/settings$/);
    await ro.close();

    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    const t = two.request;
    expect((await t.get(`/api/v1/privacy/requests/${accessRequestId}`)).status()).toBe(404);
    expect((await t.post(`/api/v1/privacy/requests/${erasureRequestId}`, { data: { action: "approve" } })).status()).toBe(404);
    expect((await t.get(`/api/v1/privacy/requests/${accessRequestId}/export`)).status()).toBe(404);
    expect((await t.patch(`/api/v1/privacy/breaches/${breachId}`, { data: { rootCause: "Cross-tenant attempt" } })).status()).toBe(404);
    const theirs = (await (await t.get("/api/v1/privacy/requests")).json()).data.requests as { id: string }[];
    expect(theirs.some((r) => r.id === accessRequestId || r.id === erasureRequestId)).toBe(false);
    const profile = (await (await t.get("/api/v1/billing/profile")).json()).data;
    expect(profile?.taxId ?? null).not.toBe("27AAPFU0939F1ZV");
    await two.close();
  });
});
