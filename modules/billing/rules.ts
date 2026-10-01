import type { BillingInterval, BillingProvider, PaidPlan, SubscriptionPlan, SubscriptionStatus, TaxIdType, TaxLine } from "@/lib/shared/types/platform";

/**
 * PLATFORM-P1-04 — the deterministic billing rules (non-negotiable #9):
 * provider routing, status mapping, GST, money formatting and billing
 * profile validation. Pure, so every rule is unit-tested.
 */

/**
 * INR is collected through Razorpay (UPI, RuPay, net banking, e-mandates for
 * Indian recurring payments under the RBI e-mandate framework); every other
 * currency through Stripe. Falls back to whichever provider is configured.
 * Null when no provider can take this currency.
 */
export function chooseProvider(currency: string, configured: { stripe: boolean; razorpay: boolean }): BillingProvider | null {
  if (currency === "INR") {
    if (configured.razorpay) return "razorpay";
    return configured.stripe ? "stripe" : null;
  }
  return configured.stripe ? "stripe" : null;
}

/** The default currency for a billing country. */
export function defaultCurrencyFor(country: string): "INR" | "EUR" | "USD" {
  if (country === "IN") return "INR";
  const EUROZONE = ["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"];
  return EUROZONE.includes(country) ? "EUR" : "USD";
}

/** Stripe subscription status → ours. */
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "incomplete":
      return "incomplete";
    case "paused":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "incomplete";
  }
}

/** Razorpay subscription status → ours. */
export function mapRazorpayStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "authenticated":
    case "created":
      return "incomplete";
    case "pending":
    case "halted":
      return "past_due";
    case "paused":
      return "paused";
    case "cancelled":
    case "completed":
    case "expired":
      return "cancelled";
    default:
      return "incomplete";
  }
}

/** Plans that keep paid entitlements; a cancelled subscription falls back to free. */
export function effectivePlan(plan: SubscriptionPlan, status: SubscriptionStatus): SubscriptionPlan {
  return status === "cancelled" ? "free" : plan;
}

/** Indian states/UTs by GST state code, for place-of-supply. */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

/** GSTIN: 2-digit state code, PAN (5 letters, 4 digits, 1 letter), entity digit, Z, checksum. */
export const GSTIN_RE = /^(0[1-9]|[1-2][0-9]|3[0-8]|97)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The GSTIN check character (mod-36 algorithm published by GSTN). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin: string): boolean {
  return GSTIN_RE.test(gstin) && gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

/** EU VAT numbers: country prefix + 2–13 alphanumerics (format check only; VIES verification is the provider's). */
export const EU_VAT_RE = /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z+*]{2,13}$/;

export const GST_RATE = 0.18;

/**
 * GST on a SaaS supply from India (SAC 998315, 18%). Intra-state supply
 * splits into CGST 9% + SGST 9%; inter-state (or an unknown customer
 * state) is IGST 18%. A supply to a customer outside India is an export of
 * services, zero-rated under LUT (no tax line). Amounts in minor units;
 * rounding puts any odd paisa on the first line so lines sum exactly.
 */
export function computeGst(
  amount: number,
  taxBehavior: "inclusive" | "exclusive",
  supplierStateCode: string | null,
  customer: { country: string; stateCode: string | null },
): { subtotal: number; tax: number; total: number; lines: TaxLine[] } {
  if (customer.country !== "IN") {
    return { subtotal: amount, tax: 0, total: amount, lines: [{ name: "IGST (export of services, zero-rated under LUT)", rate: 0, amount: 0 }] };
  }
  const subtotal = taxBehavior === "inclusive" ? Math.round(amount / (1 + GST_RATE)) : amount;
  const tax = taxBehavior === "inclusive" ? amount - subtotal : Math.round(amount * GST_RATE);
  const total = subtotal + tax;
  if (supplierStateCode && customer.stateCode && supplierStateCode === customer.stateCode) {
    const half = Math.floor(tax / 2);
    return { subtotal, tax, total, lines: [{ name: "CGST", rate: 0.09, amount: tax - half }, { name: "SGST", rate: 0.09, amount: half }] };
  }
  return { subtotal, tax, total, lines: [{ name: "IGST", rate: GST_RATE, amount: tax }] };
}

/** The state code a GSTIN encodes, or null. */
export function stateCodeFromGstin(gstin: string | null): string | null {
  return gstin && GSTIN_RE.test(gstin) ? gstin.slice(0, 2) : null;
}

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"]);

/** Minor units → a display string, e.g. 49900 USD → "$499.00". */
export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  const major = ZERO_DECIMAL.has(currency) ? minor : minor / 100;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : locale, { style: "currency", currency }).format(major);
}

export function intervalLabel(interval: BillingInterval): string {
  return interval === "month" ? "per month" : "per year";
}

export function planLabel(plan: SubscriptionPlan | PaidPlan): string {
  return { free: "Free", pro: "Pro", max: "Max", enterprise: "Enterprise" }[plan];
}

export type BillingProfileInput = {
  legalName: string;
  billingEmail: string;
  country: string;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  taxIdType: TaxIdType | null;
  taxId: string | null;
};

const TAX_ID_TYPES: TaxIdType[] = ["in_gst", "eu_vat", "gb_vat", "au_abn", "us_ein", "other"];

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Validates and normalises a billing profile form. */
export function validateBillingProfile(raw: Record<string, unknown>): { ok: true; value: BillingProfileInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const legalName = str(raw.legalName, 200);
  const billingEmail = str(raw.billingEmail, 320)?.toLowerCase() ?? null;
  const country = str(raw.country, 2)?.toUpperCase() ?? null;
  const taxIdTypeRaw = str(raw.taxIdType, 20);
  const taxId = str(raw.taxId, 40)?.toUpperCase().replace(/\s+/g, "") ?? null;

  if (!legalName || legalName.length < 2) errors.legalName = "Enter the legal name to invoice.";
  if (!billingEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(billingEmail)) errors.billingEmail = "Enter a valid billing email.";
  if (!country || !/^[A-Z]{2}$/.test(country)) errors.country = "Choose a country.";

  let taxIdType: TaxIdType | null = null;
  if (taxIdTypeRaw || taxId) {
    if (!taxIdTypeRaw || !TAX_ID_TYPES.includes(taxIdTypeRaw as TaxIdType)) errors.taxIdType = "Choose the tax id type.";
    else taxIdType = taxIdTypeRaw as TaxIdType;
    if (!taxId) errors.taxId = "Enter the tax id, or clear the type.";
    else if (taxIdType === "in_gst" && !isValidGstin(taxId)) errors.taxId = "That is not a valid GSTIN.";
    else if (taxIdType === "eu_vat" && !EU_VAT_RE.test(taxId)) errors.taxId = "That is not a valid EU VAT number.";
    else if (taxIdType === "gb_vat" && !/^GB([0-9]{9}|[0-9]{12}|GD[0-9]{3}|HA[0-9]{3})$/.test(taxId)) errors.taxId = "That is not a valid UK VAT number.";
    else if (taxIdType === "in_gst" && country !== "IN") errors.taxId = "A GSTIN applies to an Indian billing address.";
  }
  const region = str(raw.region, 100);
  if (country === "IN" && !region && taxIdType !== "in_gst") errors.region = "Choose the state (needed for GST place of supply).";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      legalName: legalName!,
      billingEmail: billingEmail!,
      country: country!,
      region,
      city: str(raw.city, 100),
      postalCode: str(raw.postalCode, 20),
      addressLine1: str(raw.addressLine1, 200),
      addressLine2: str(raw.addressLine2, 200),
      taxIdType,
      taxId: taxIdType ? taxId : null,
    },
  };
}

/** The GST state code for an Indian billing profile: from the GSTIN, else from the chosen state code. */
export function customerStateCode(profile: { country: string; region: string | null; taxIdType: TaxIdType | null; taxId: string | null }): string | null {
  if (profile.country !== "IN") return null;
  const fromGstin = profile.taxIdType === "in_gst" ? stateCodeFromGstin(profile.taxId) : null;
  if (fromGstin) return fromGstin;
  return profile.region && GST_STATE_CODES[profile.region] ? profile.region : null;
}

/** The current Indian financial year label ("2026-27") for a date. */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
