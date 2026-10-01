// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REDACTED, luhnValid, redact, redactString, safeErrorMessage } from "./redact";

describe("redact — FOUNDATION-P0-30", () => {
  it("removes credentials, card, bank and contact fields at any depth", () => {
    const out = redact({
      id: "evt_1",
      data: {
        object: {
          amount: 49900,
          card: { last4: "4242", brand: "visa" },
          email: "cfo@acme.example",
          billing_details: { address: { line1: "1 Main St" } },
          bank_account: { account_number: "000123456789", ifsc: "HDFC0001234" },
          metadata: { api_key: "abc", note: "fine" },
        },
      },
    }) as { data: { object: Record<string, unknown> } };
    const obj = out.data.object;
    expect(obj.amount).toBe(49900);
    expect(obj.card).toBe(REDACTED);
    expect(obj.email).toBe(REDACTED);
    expect(obj.billing_details).toBe(REDACTED);
    expect((obj.bank_account as Record<string, unknown>).account_number).toBe(REDACTED);
    expect((obj.bank_account as Record<string, unknown>).ifsc).toBe(REDACTED);
    expect((obj.metadata as Record<string, unknown>).api_key).toBe(REDACTED);
    expect((obj.metadata as Record<string, unknown>).note).toBe("fine");
  });

  it("masks secrets and card numbers inside free text", () => {
    expect(redactString("key sk_live_abcdefghijklmnop failed")).toBe(`key ${REDACTED} failed`);
    expect(redactString("Authorization: Bearer abc.def.ghijklmnop")).not.toContain("abc.def");
    expect(redactString("card 4242 4242 4242 4242 declined")).toBe(`card ${REDACTED} declined`);
    // A Luhn-invalid digit run (an order number) is kept.
    expect(redactString("order 1234567890123")).toBe("order 1234567890123");
  });

  it("bounds depth and size", () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(JSON.stringify(redact(deep))).toContain(REDACTED);
    expect((redact("x".repeat(10_000)) as string).length).toBeLessThanOrEqual(4001);
  });

  it("luhnValid", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
  });

  it("safeErrorMessage never echoes a key", () => {
    expect(safeErrorMessage(new Error("Invalid API Key provided: sk_test_1234567890abcdef"))).not.toContain("sk_test_1234567890abcdef");
  });
});
