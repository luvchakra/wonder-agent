import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { getSecretEncryptionKey } from "@/lib/db/env";

/**
 * Generic server-side envelope encryption for secrets other modules must
 * persist (e.g. Integration Agent's integration_credentials) — see
 * docs/plan/01-FOUNDATION-AGENT-BACKLOG.md FOUNDATION-P0-05.2.
 *
 * Architecture decision (resolving the backlog's "stop and report if
 * unclear" flag): implemented with Node's built-in AES-256-GCM rather than
 * Postgres pgcrypto or Supabase Vault. Rationale — it needs no
 * project-tier-dependent feature (Vault availability varies by plan), no
 * extra round trip to the database for a value only ever handled in trusted
 * server code, and AES-256-GCM with a random IV and an authentication tag is
 * a standard, auditable approach. The key is a 32-byte secret sourced from
 * `SECRET_ENCRYPTION_KEY` (never the Supabase anon/service-role key).
 * Ciphertext format: base64(iv) + "." + base64(authTag) + "." + base64(ciphertext).
 */

function getKey(): Buffer {
  const raw = getSecretEncryptionKey();
  // Accept either a base64-encoded 32-byte key or an arbitrary passphrase —
  // derive a stable 32-byte key either way so operators aren't forced into a
  // brittle "must be exactly base64 of 32 bytes" requirement.
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(raw, "utf8").digest();
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ".",
  );
}

export async function decryptSecret(payload: string): Promise<string> {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret payload");
  }
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
