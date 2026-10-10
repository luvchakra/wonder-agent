import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * Object-page CSV import and export, against the real app and database
 * (2026-10-10, non-negotiable #20). An import is a file the organization's
 * "File imports" connection receives and syncs through the connector
 * framework: it is checked before it is stored, synced inline when small,
 * and visible only to its own organization. Export streams the page's list
 * as CSV for the signed-in organization only.
 */

const stamp = Date.now();
const csv = (rows: string[]) => ["externalId,displayName,email", ...rows].join("\r\n") + "\r\n";
const upload = (kind: string, body: string, name = `e2e-${stamp}.csv`) => ({
  multipart: { kind, file: { name, mimeType: "text/csv", buffer: Buffer.from(body, "utf8") } },
});

let connectionId = "";

test.describe.serial("object-page CSV import and export", () => {
  test.use({ storageState: authFile("adminOne") });

  test("a valid file is received by the File imports connection and synced", async ({ request }) => {
    const res = await request.post(
      "/api/v1/imports",
      upload("identity", csv([`e2e-imp-${stamp}-1,E2E Import One,e2e-imp-1-${stamp}@example.test`, `e2e-imp-${stamp}-2,"Import, Two",e2e-imp-2-${stamp}@example.test`])),
    );
    expect(res.status(), await res.text()).toBe(202);
    const data = (await res.json()).data;
    expect(data.rows).toBe(2);
    expect(data.sync).toBe("completed");
    connectionId = data.integrationId;

    // The same connection takes the next import: one per organization.
    const again = await request.post("/api/v1/imports", upload("identity", csv([`e2e-imp-${stamp}-3,E2E Import Three,`])));
    expect(again.status(), await again.text()).toBe(202);
    expect((await again.json()).data.integrationId).toBe(connectionId);

    const conn = await request.get(`/api/v1/integrations/${connectionId}`);
    expect(conn.status()).toBe(200);
    expect((await conn.json()).data.name).toBe("File imports");
  });

  test("a file without the required column is refused before anything is stored", async ({ request }) => {
    const res = await request.post("/api/v1/imports", upload("identity", "displayName,email\r\nNo Id,x@example.test\r\n"));
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/externalId/);
  });

  test("an unknown kind is refused", async ({ request }) => {
    const res = await request.post("/api/v1/imports", upload("tenant", csv(["a,b,c"])));
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

  test("another organization cannot see the connection, and a read-only member cannot import", async ({ browser }) => {
    const two = await browser.newContext({ storageState: authFile("adminTwo") });
    expect((await two.request.get(`/api/v1/integrations/${connectionId}`)).status()).toBe(404);
    await two.close();

    const ro = await browser.newContext({ storageState: authFile("readOnly") });
    const res = await ro.request.post("/api/v1/imports", upload("identity", csv([`e2e-ro-${stamp},Read Only,`])));
    expect(res.status()).toBe(403);
    await ro.close();
  });
});
