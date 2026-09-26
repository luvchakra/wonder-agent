import { test, expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authFile } from "./support/testUsers";

/**
 * INTEGRATION-P0-11 / spec S8 — the outbound SSRF guard against the real
 * app. The test server runs with OUTBOUND_ALLOW_PRIVATE_NETWORKS=true (its
 * stubs listen on 127.0.0.1), which production never sets; even so, cloud
 * metadata, non-http(s) schemes and credentials in URLs are refused, and a
 * redirect toward metadata is refused at request time.
 */

let redirector: http.Server;
let redirectUrl = "";

test.beforeAll(async () => {
  redirector = http.createServer((_req, res) => {
    res.writeHead(307, { location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" });
    res.end();
  });
  await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
  redirectUrl = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}/mcp`;
});
test.afterAll(async () => {
  await new Promise((resolve) => redirector?.close(resolve));
});

test.describe("outbound SSRF guard", () => {
  test.use({ storageState: authFile("adminOne") });
  const stamp = Date.now();

  test("disallowed base URLs are refused when the integration is configured", async ({ request }) => {
    for (const baseUrl of [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://[::ffff:169.254.169.254]/",
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_",
      "https://user:secret@example.com/api",
    ]) {
      const res = await request.post("/api/v1/integrations", { data: { integrationTypeId: "mcp", name: `E2E SSRF ${stamp}`, config: { baseUrl } } });
      expect(res.status(), baseUrl).toBe(400);
      expect((await res.json()).error.code, baseUrl).toBe("OUTBOUND_BLOCKED");
    }
  });

  test("a redirect toward cloud metadata is refused at request time, and nothing leaks into the message", async ({ request }) => {
    const created = await request.post("/api/v1/integrations", {
      data: { integrationTypeId: "mcp", name: `E2E SSRF redirect ${stamp}`, config: { baseUrl: redirectUrl } },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json()).data.id as string;
    const tested = await request.post(`/api/v1/integrations/${id}/test`);
    expect(tested.status()).toBe(200);
    const result = (await tested.json()).data as { ok: boolean; message?: string };
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/metadata/);
    expect(result.message).not.toMatch(/security-credentials/);
  });
});
