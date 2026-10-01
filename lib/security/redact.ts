/**
 * FOUNDATION-P0-30 — structured redaction for anything stored or logged
 * from an external source (webhook payloads, provider error bodies) or
 * written to server logs (CLAUDE.md §17.7, non-negotiable #10; GDPR
 * Art. 5(1)(c) data minimisation; PCI DSS 3.3 / 3.4).
 *
 * Pure and dependency-free so it can run anywhere (route handlers, the
 * webhook intake, tests). Keys are matched case-insensitively against a
 * deny list; values are additionally scanned for card numbers (Luhn-valid
 * 13–19 digit runs), bearer tokens and provider secret-key shapes, so a
 * secret in an unexpected field is still masked.
 */

export const REDACTED = "[REDACTED]";

/** Keys whose values are never kept: credentials, card and bank data, contact details. */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /pass(word|phrase)?/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authori[sz]ation/i,
  /cookie/i,
  /private[_-]?key/i,
  /signature/i,
  /^(card|cvc|cvv|cvv2|pan|exp_month|exp_year|expiry|number|fingerprint|last4|iin|bin)$/i,
  /account[_-]?number/i,
  /ifsc/i,
  /iban/i,
  /routing/i,
  /^vpa$/i,
  /^(email|contact|phone|mobile)$/i,
  /^(name|first_name|last_name|full_name)$/i,
  /^(address|line1|line2|postal_code|zip|shipping|billing_details)$/i,
  /^ip(_address)?$/i,
];

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}\b/g, // Stripe keys
  /\bwhsec_[A-Za-z0-9]{8,}\b/g, // Stripe webhook secrets
  /\brzp_(live|test)_[A-Za-z0-9]{8,}\b/g, // Razorpay key ids
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

/** Luhn check, for spotting card numbers in free text. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** Masks secrets and card numbers inside a free-text string. */
export function redactString(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, REDACTED);
  out = out.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => (luhnValid(m.replace(/[ -]/g, "")) ? REDACTED : m));
  return out;
}

/**
 * Deep-copies `value` with sensitive keys replaced by REDACTED and secret
 * shapes masked in strings. Depth- and size-bounded so a hostile payload
 * cannot make it run away.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === "string") return redactString(value.length > 4000 ? `${value.slice(0, 4000)}…` : value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    out[k] = isSensitiveKey(k) && v !== null && v !== undefined ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

/** Error text safe for logs and stored error columns. */
export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
  return redactString(raw).slice(0, 1000);
}
