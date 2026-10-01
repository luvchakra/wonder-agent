// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  chooseProvider,
  computeGst,
  customerStateCode,
  defaultCurrencyFor,
  effectivePlan,
  financialYear,
  formatMoney,
  gstinCheckChar,
  isValidGstin,
  mapRazorpayStatus,
  mapStripeStatus,
  validateBillingProfile,
} from "./rules";

describe("chooseProvider — PLATFORM-P1-04", () => {
  it("routes INR to Razorpay and everything else to Stripe", () => {
    expect(chooseProvider("INR", { stripe: true, razorpay: true })).toBe("razorpay");
    expect(chooseProvider("USD", { stripe: true, razorpay: true })).toBe("stripe");
    expect(chooseProvider("EUR", { stripe: true, razorpay: true })).toBe("stripe");
  });
  it("falls back to Stripe for INR when Razorpay is not configured", () => {
    expect(chooseProvider("INR", { stripe: true, razorpay: false })).toBe("stripe");
  });
  it("never routes a non-INR currency to Razorpay, and refuses when nothing is configured", () => {
    expect(chooseProvider("USD", { stripe: false, razorpay: true })).toBeNull();
    expect(chooseProvider("INR", { stripe: false, razorpay: false })).toBeNull();
  });
});

describe("currency defaults", () => {
  it("India → INR, eurozone → EUR, else USD", () => {
    expect(defaultCurrencyFor("IN")).toBe("INR");
    expect(defaultCurrencyFor("DE")).toBe("EUR");
    expect(defaultCurrencyFor("GB")).toBe("USD");
  });
});

describe("status mapping", () => {
  it("maps Stripe statuses", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("canceled")).toBe("cancelled");
    expect(mapStripeStatus("incomplete_expired")).toBe("cancelled");
    expect(mapStripeStatus("something_new")).toBe("incomplete");
  });
  it("maps Razorpay statuses", () => {
    expect(mapRazorpayStatus("active")).toBe("active");
    expect(mapRazorpayStatus("authenticated")).toBe("incomplete");
    expect(mapRazorpayStatus("halted")).toBe("past_due");
    expect(mapRazorpayStatus("completed")).toBe("cancelled");
  });
  it("a cancelled subscription falls back to the free plan's entitlements", () => {
    expect(effectivePlan("max", "cancelled")).toBe("free");
    expect(effectivePlan("max", "past_due")).toBe("max");
  });
});

describe("GSTIN", () => {
  it("accepts GSTINs with a correct check character", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("29AAGCB7383J1Z4")).toBe(true);
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });
  it("rejects a wrong check character, a bad state code or a bad shape", () => {
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false);
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1V")).toBe(false);
  });
});

describe("computeGst", () => {
  it("splits an intra-state inclusive amount into CGST + SGST that sum exactly", () => {
    const r = computeGst(3999900, "inclusive", "27", { country: "IN", stateCode: "27" });
    expect(r.total).toBe(3999900);
    expect(r.subtotal + r.tax).toBe(3999900);
    expect(r.subtotal).toBe(Math.round(3999900 / 1.18));
    expect(r.lines.map((l) => l.name)).toEqual(["CGST", "SGST"]);
    expect(r.lines[0].amount + r.lines[1].amount).toBe(r.tax);
  });
  it("charges IGST for an inter-state supply or an unknown customer state", () => {
    expect(computeGst(1000000, "inclusive", "27", { country: "IN", stateCode: "29" }).lines).toEqual([{ name: "IGST", rate: 0.18, amount: 1000000 - Math.round(1000000 / 1.18) }]);
    expect(computeGst(1000000, "exclusive", "27", { country: "IN", stateCode: null }).lines[0].name).toBe("IGST");
  });
  it("adds 18% on top of an exclusive amount", () => {
    const r = computeGst(100000, "exclusive", "27", { country: "IN", stateCode: "27" });
    expect(r.tax).toBe(18000);
    expect(r.total).toBe(118000);
  });
  it("zero-rates an export of services", () => {
    const r = computeGst(49900, "exclusive", "27", { country: "US", stateCode: null });
    expect(r.tax).toBe(0);
    expect(r.total).toBe(49900);
  });
});

describe("customerStateCode", () => {
  it("prefers the state encoded in the GSTIN", () => {
    expect(customerStateCode({ country: "IN", region: "07", taxIdType: "in_gst", taxId: "29AAGCB7383J1Z4" })).toBe("29");
    expect(customerStateCode({ country: "IN", region: "07", taxIdType: null, taxId: null })).toBe("07");
    expect(customerStateCode({ country: "US", region: "CA", taxIdType: null, taxId: null })).toBeNull();
  });
});

describe("financialYear", () => {
  it("uses India's April–March year in IST", () => {
    expect(financialYear(new Date("2026-03-31T18:00:00Z"))).toBe("2025-26"); // 23:30 IST, 31 March
    expect(financialYear(new Date("2026-03-31T18:31:00Z"))).toBe("2026-27"); // 00:01 IST, 1 April
    expect(financialYear(new Date("2099-12-01T00:00:00Z"))).toBe("2099-00");
  });
});

describe("formatMoney", () => {
  it("formats minor units", () => {
    expect(formatMoney(49900, "USD")).toBe("$499.00");
    expect(formatMoney(3999900, "INR")).toContain("39,999");
  });
});

describe("validateBillingProfile", () => {
  const base = { legalName: "Acme Finance Pvt Ltd", billingEmail: "AP@Acme.example", country: "in", region: "27" };
  it("normalises a valid profile", () => {
    const r = validateBillingProfile({ ...base, taxIdType: "in_gst", taxId: "27aapfu0939f1zv" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.country).toBe("IN");
      expect(r.value.billingEmail).toBe("ap@acme.example");
      expect(r.value.taxId).toBe("27AAPFU0939F1ZV");
    }
  });
  it("rejects an invalid GSTIN, a GSTIN outside India, and a missing Indian state", () => {
    const bad = validateBillingProfile({ ...base, taxIdType: "in_gst", taxId: "27AAPFU0939F1ZX" });
    expect(bad.ok).toBe(false);
    const abroad = validateBillingProfile({ ...base, country: "US", taxIdType: "in_gst", taxId: "27AAPFU0939F1ZV" });
    expect(abroad.ok).toBe(false);
    const noState = validateBillingProfile({ ...base, region: "" });
    expect(noState.ok === false && noState.errors.region).toBeTruthy();
  });
  it("requires a name, email and country", () => {
    const r = validateBillingProfile({ legalName: "", billingEmail: "nope", country: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["billingEmail", "country", "legalName"]);
  });
  it("validates EU VAT format", () => {
    expect(validateBillingProfile({ legalName: "Acme GmbH", billingEmail: "a@b.de", country: "DE", taxIdType: "eu_vat", taxId: "DE123456789" }).ok).toBe(true);
    expect(validateBillingProfile({ legalName: "Acme GmbH", billingEmail: "a@b.de", country: "DE", taxIdType: "eu_vat", taxId: "XX123" }).ok).toBe(false);
  });
});
