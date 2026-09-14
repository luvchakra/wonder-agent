// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHmacSignature } from "./webhooks";

describe("verifyHmacSignature — INTEGRATION-P0-04.3", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ id: "evt_1", type: "user.updated" });

  it("accepts a correctly signed body", () => {
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyHmacSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a body signed with the wrong secret", () => {
    const signature = createHmac("sha256", "wrong-secret").update(body, "utf8").digest("hex");
    expect(verifyHmacSignature(body, signature, secret)).toBe(false);
  });

  it("rejects a tampered body against the original signature", () => {
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    const tamperedBody = JSON.stringify({ id: "evt_1", type: "user.deleted" });
    expect(verifyHmacSignature(tamperedBody, signature, secret)).toBe(false);
  });

  it("rejects a malformed/short signature without throwing", () => {
    expect(verifyHmacSignature(body, "not-a-real-signature", secret)).toBe(false);
  });
});
