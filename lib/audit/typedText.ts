import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * WID-H07 (owner decision, 12 October 2026): text a person typed (a reason,
 * a justification, a note) is kept out of audit records. The audit row keeps
 * the record's id and a fingerprint of the text; the words stay on the
 * request, task or finding they belong to, where erasure can reach them.
 *
 * The fingerprint is an HMAC-SHA256 keyed from SECRET_ENCRYPTION_KEY and the
 * tenant, so it proves which text was given (anyone holding the text can
 * check it) without the audit trail revealing it, and a short reason cannot
 * be guessed from it without the server's key. A retired key
 * (SECRET_ENCRYPTION_KEY_PREVIOUS) still verifies older fingerprints.
 */

export type TextFingerprint = { fingerprint: string | null; length: number };

const VERSION = "hmac-sha256:v1";

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(`wonderid-audit-text:${secret}`, "utf8").digest();
}

function currentKeys(): Buffer[] {
  return [process.env.SECRET_ENCRYPTION_KEY ?? "", ...(process.env.SECRET_ENCRYPTION_KEY_PREVIOUS ?? "").split(",")]
    .map((k) => k.trim())
    .filter(Boolean)
    .map(keyFrom);
}

function digest(key: Buffer, tenantId: string, text: string): string {
  return createHmac("sha256", key).update(`${tenantId}\u0000${text}`, "utf8").digest("hex");
}

/** The fingerprint of typed text; null fingerprint when no key is configured (the text is still never stored). */
export function fingerprintText(tenantId: string, text: string): TextFingerprint {
  const [key] = currentKeys();
  return { fingerprint: key ? `${VERSION}:${digest(key, tenantId, text)}` : null, length: text.length };
}

/** Whether `text` is the text an audit fingerprint was made from, under the current or a retired key. */
export function matchesFingerprint(tenantId: string, text: string, fingerprint: string): boolean {
  if (!fingerprint.startsWith(`${VERSION}:`)) return false;
  const want = Buffer.from(fingerprint.slice(VERSION.length + 1), "hex");
  return currentKeys().some((key) => {
    const got = Buffer.from(digest(key, tenantId, text), "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/**
 * The audit metadata for typed text: each field becomes its fingerprint
 * (null stays null). Any metadata key with the same name is dropped, so the
 * words cannot reach the row by both routes.
 */
export function withTypedText(
  tenantId: string,
  metadata: Record<string, unknown> | undefined,
  typedText: Record<string, string | null | undefined> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(metadata ?? {}) };
  if (!typedText) return out;
  const prints: Record<string, TextFingerprint | null> = {};
  for (const [key, value] of Object.entries(typedText)) {
    delete out[key];
    if (value === undefined) continue;
    prints[key] = value === null || value === "" ? null : fingerprintText(tenantId, value);
  }
  if (Object.keys(prints).length) out.typedText = prints;
  return out;
}
