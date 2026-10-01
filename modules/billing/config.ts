import "server-only";

/**
 * PLATFORM-P1-04 — billing provider configuration. Every value is a
 * server-only secret or setting (non-negotiable #10): read only here, never
 * exported to a client component, never logged. A provider with no key is
 * simply "not configured" and the UI says so; nothing throws at import.
 */

function serverOnly(name: string): string | null {
  if (typeof window !== "undefined") throw new Error(`${name} must never be read from client code.`);
  return process.env[name] || null;
}

export function stripeConfig(): { secretKey: string; webhookSecret: string | null; automaticTax: boolean } | null {
  const secretKey = serverOnly("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  return { secretKey, webhookSecret: serverOnly("STRIPE_WEBHOOK_SECRET"), automaticTax: serverOnly("STRIPE_AUTOMATIC_TAX") === "true" };
}

export function razorpayConfig(): { keyId: string; keySecret: string; webhookSecret: string | null } | null {
  const keyId = serverOnly("RAZORPAY_KEY_ID");
  const keySecret = serverOnly("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret: serverOnly("RAZORPAY_WEBHOOK_SECRET") };
}

export function configuredProviders(): { stripe: boolean; razorpay: boolean } {
  return { stripe: stripeConfig() !== null, razorpay: razorpayConfig() !== null };
}

/** The supplier's GST state code (first two digits of its GSTIN), for CGST/SGST vs IGST. */
export function supplierGst(): { gstin: string | null; stateCode: string | null } {
  const gstin = serverOnly("BILLING_SUPPLIER_GSTIN");
  const stateCode = serverOnly("BILLING_SUPPLIER_STATE_CODE") ?? (gstin ? gstin.slice(0, 2) : null);
  return { gstin, stateCode };
}

/**
 * The absolute origin used in provider return URLs. A configured
 * APP_BASE_URL wins so a forged Host header can never send a customer back
 * to someone else's site after paying.
 */
export function appBaseUrl(fallbackOrigin: string): string {
  const configured = serverOnly("APP_BASE_URL");
  return (configured ?? fallbackOrigin).replace(/\/+$/, "");
}
