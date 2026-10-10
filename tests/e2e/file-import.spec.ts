import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * Object-page CSV import and export, against the real app and database
 * (2026-10-10, non-negotiable #20, and the user's decision on imports): a
 * file is previewed first, without storing anything; confirming it makes it
 * an upload of the organization's "File imports" connection, which syncs it
 * through the connector framework, and its records are then added to the
 * page's list or update the ones already there. Additive only: a record
 * missing from a later file stays as it was. Everything is visible only to
 * its own organization. Export streams the page's list as CSV.
 */

const stamp = Date.now();
const csv = (rows: string[], header = "externalId,displayName,email,department") => [header, ...rows].join("\r\n") + "\r\n";
const upload = (kind: string, body: string, name = `e2e-${stamp}.csv`, scope = "people") => ({
  multipart: { kind, scope, file: { name, mimeType: "text/csv", buffer: Buffer.from(body, "utf8") } },
});
const one = `e2e-imp-${stamp}-1`;
const two = `e2e-imp-${stamp}-2`;

let connectionId = "";

test.describe.serial("object-page CSV import and export", () => {
  test.use({ storageState: authFile("adminOne") });

  test("the preview plans every row and stores nothing", async ({ request }) => {
    const file = csv([`${one},E2E Import One,e2e-imp-1-${stamp}@example.test,Ops`, `${two},"Import, Two",e2e-imp-2-${stamp}@example.test,Finance`, `,No Id,,`]);
    const res = await request.post("/api/v1/imports/preview", upload("identity", file));
    expect(res.status(), await res.text()).toBe(200);
    const data = (await res.json()).data;
    expect(data.rows).toBe(3);
    expect(data.counts).toMatchObject({ new: 2, invalid: 1 });
    expect(data.columns).toEqual(["externalId", "displayName", "email", "department"]);
    expect(data.shown[1].values.displayName).toBe("Import, Two");

    const list = await request.get(`/api/v1/identities?q=${encodeURIComponent(`e2e-imp-1-${stamp}`)}`);
    expect((await list.json()).data).toHaveLength(0);
  });

  test("confirming adds the records to the list, through the File imports connection", async ({ request }) => {
    const file = csv([`${one},E2E Import One,e2e-imp-1-${stamp}@example.test,Ops`, `${two},"Import, Two",e2e-imp-2-${stamp}@example.test,Finance`]);
    const res = await request.post("/api/v1/imports", upload("identity", file));
    expect(res.status(), await res.text()).toBe(200);
    const data = (await res.json()).data;
    expect(data.rows).toBe(2);
    expect(data.counts).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0, failed: 0 });
    connectionId = data.integrationId;

    const list = await request.get(`/api/v1/identities?q=${encodeURIComponent(`e2e-imp-1-${stamp}`)}`);
    const rows = (await list.json()).data as { displayName: string; department: string | null; identityType: string; status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ displayName: "E2E Import One", department: "Ops", identityType: "HUMAN", status: "active" });

    const conn = await request.get(`/api/v1/integrations/${connectionId}`);
    expect(conn.status()).toBe(200);
    expect((await conn.json()).data.name).toBe("File imports");
  });

  test("a later file updates existing records and leaves the ones it omits alone", async ({ request }) => {
    const file = csv([`${one},E2E Import One,e2e-imp-1-${stamp}@example.test,Security`]);
    const preview = await request.post("/api/v1/imports/preview", upload("identity", file));
    const planned = (await preview.json()).data;
    expect(planned.counts).toMatchObject({ update: 1, new: 0 });
    expect(planned.shown[0].changes).toEqual([{ field: "department", from: "Ops", to: "Security" }]);

    const res = await request.post("/api/v1/imports", upload("identity", file));
    expect(res.status(), await res.text()).toBe(200);
    const data = (await res.json()).data;
    expect(data.counts).toMatchObject({ created: 0, updated: 1 });
    // The same connection takes every import: one per organization.
    expect(data.integrationId).toBe(connectionId);

    const updated = (await (await request.get(`/api/v1/identities?q=${encodeURIComponent(`e2e-imp-1-${stamp}`)}`)).json()).data;
    expect(updated[0].department).toBe("Security");
    const omitted = (await (await request.get(`/api/v1/identities?q=${encodeURIComponent(`e2e-imp-2-${stamp}`)}`)).json()).data;
    expect(omitted).toHaveLength(1);
    expect(omitted[0]).toMatchObject({ status: "active", department: "Finance" });
  });

  test("a person's access from a file is recorded, and their Access tab says no approval was found (ACCESS-P0-24)", async ({ page, request }) => {
    // Four imports, each through the File imports connection.
    test.slow();
    const app = `E2E Ledger App ${stamp}`;
    const ent = `E2E Ledger Read ${stamp}`;
    const acc = `e2e-ledger-acc-${stamp}`;
    const steps: [string, string, string][] = [
      ["application", "externalId,name,category,description", `e2e-ledger-app-${stamp},${app},Data,`],
      ["entitlement", "externalId,name,application,privilegeLevel,dataClassification", `e2e-ledger-ent-${stamp},${ent},${app},standard,`],
      ["account", "externalId,application,username,owner,status,accountType,lastLoginAt", `${acc},${app},imp1,e2e-imp-1-${stamp}@example.test,active,standard,`],
      ["access_grant", "accountExternalId,entitlementExternalId,grantType", `${acc},${ent},direct`],
    ];
    for (const [kind, header, row] of steps) {
      const res = await request.post("/api/v1/imports", upload(kind, csv([row], header)));
      expect(res.status(), `${kind}: ${await res.text()}`).toBe(200);
      expect((await res.json()).data.counts, kind).toMatchObject({ created: 1, failed: 0, skipped: 0 });
    }

    const person = ((await (await request.get(`/api/v1/identities?q=${encodeURIComponent(`e2e-imp-1-${stamp}`)}`)).json()).data as { id: string }[])[0]!;
    await page.goto(`/identities/${person.id}?tab=access`);
    const panel = page.getByRole("tabpanel");
    // The account and its entitlement, both reported by the file and with no WonderID approval behind them.
    await expect(panel.getByText(app)).toHaveCount(2);
    await expect(panel.getByText(ent)).toBeVisible();
    await expect(panel.getByText("No approval found")).toHaveCount(2);
    await expect(panel.getByText("Reported by a connection").first()).toBeVisible();
  });

  test("the page shows a preview table, and Confirm import adds the row to the list", async ({ page }) => {
    const id = `e2e-ui-${stamp}`;
    await page.goto("/identities/humans");
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Import CSV…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/CSV file/).setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv([`${id},E2E Dialog Person,${id}@example.test,Design`]), "utf8") });
    await dialog.getByRole("button", { name: "Preview" }).click();
    await expect(dialog.getByRole("table")).toContainText("E2E Dialog Person");
    await expect(dialog.getByRole("table")).toContainText("New");
    await dialog.getByRole("button", { name: /Confirm import \(1\)/ }).click();
    await expect(dialog.getByRole("status")).toContainText("1 added");
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.goto(`/identities/humans?q=${encodeURIComponent(id)}`);
    await expect(page.getByRole("link", { name: "E2E Dialog Person" })).toBeVisible();
  });

  test("Cancel import stores nothing", async ({ page, request }) => {
    const id = `e2e-cancel-${stamp}`;
    await page.goto("/identities/humans");
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Import CSV…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/CSV file/).setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv([`${id},E2E Cancelled,,`]), "utf8") });
    await dialog.getByRole("button", { name: "Preview" }).click();
    await expect(dialog.getByRole("table")).toContainText("E2E Cancelled");
    await dialog.getByRole("button", { name: "Cancel import" }).click();
    await expect(dialog).toBeHidden();
    const list = await request.get(`/api/v1/identities?q=${encodeURIComponent("E2E Cancelled")}`);
    expect((await list.json()).data).toHaveLength(0);
  });

  test("a file without the required column is refused before anything is stored", async ({ request }) => {
    for (const path of ["/api/v1/imports/preview", "/api/v1/imports"]) {
      const res = await request.post(path, upload("identity", "displayName,email\r\nNo Id,x@example.test\r\n"));
      expect(res.status()).toBe(400);
      expect((await res.json()).error.message).toMatch(/externalId/);
    }
  });

  test("an unknown kind is refused", async ({ request }) => {
    const res = await request.post("/api/v1/imports", upload("tenant", csv(["a,b,c,d"])));
    expect(res.status()).toBe(400);
  });

  test("export streams the list as CSV, and the template is just the header row", async ({ request }) => {
    const res = await request.get("/api/v1/exports/identities");
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["cache-control"]).toContain("no-store");
    const text = await res.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split("\r\n")[0]).toContain("externalId");

    const template = await request.get("/api/v1/exports/identities?template=1");
    expect(template.status()).toBe(200);
    const lines = (await template.text()).replace(/^﻿/, "").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^externalId/);

    expect((await request.get("/api/v1/exports/not-an-object")).status()).toBe(404);
  });

  test("another organization sees neither the connection nor the records, and a read-only member cannot import", async ({ browser }) => {
    const other = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await other.request.get(`/api/v1/integrations/${connectionId}`)).status()).toBe(404);
    const theirs = await other.request.get(`/api/v1/identities?q=${encodeURIComponent(`e2e-imp-1-${stamp}`)}`);
    expect((await theirs.json()).data).toHaveLength(0);
    await other.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    for (const path of ["/api/v1/imports/preview", "/api/v1/imports"]) {
      const res = await ro.request.post(path, upload("identity", csv([`e2e-ro-${stamp},Read Only,,`])));
      expect(res.status()).toBe(403);
    }
    await ro.close();
  });
});
