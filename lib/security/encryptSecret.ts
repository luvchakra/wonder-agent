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

function deriveKey(raw: string): Buffer {
  // Accept either a base64-encoded 32-byte key or an arbitrary passphrase —
  // derive a stable 32-byte key either way so operators aren't forced into a
  // brittle "must be exactly base64 of 32 bytes" requirement.
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(raw, "utf8").digest();
}

function getKey(): Buffer {
  return deriveKey(getSecretEncryptionKey());
}

/**
 * FOUNDATION-P0-30 — key rotation. `SECRET_ENCRYPTION_KEY_PREVIOUS` holds
 * retired keys (comma-separated, newest first). New ciphertext always uses
 * the current key; decryption tries the current key, then each retired one.
 * AES-GCM's authentication tag makes a wrong key fail loudly rather than
 * yield garbage, so trying keys in order is safe. Rotate by moving the
 * current key into the PREVIOUS list, setting a new current key, and
 * re-encrypting stored values with `reencryptSecret()`; drop the old key
 * once nothing needs it.
 */
function getPreviousKeys(): Buffer[] {
  if (typeof window !== "undefined") {
    throw new Error("SECRET_ENCRYPTION_KEY_PREVIOUS must never be read from client code.");
  }
  return (process.env.SECRET_ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map(deriveKey);
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

function decryptWith(key: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Decrypts and reports whether a retired key was needed (i.e. re-encryption is due). */
export async function decryptSecretWithKeyInfo(payload: string): Promise<{ plaintext: string; usedPreviousKey: boolean }> {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret payload");
  }
  try {
    return { plaintext: decryptWith(getKey(), ivB64, tagB64, dataB64), usedPreviousKey: false };
  } catch (err) {
    for (const key of getPreviousKeys()) {
      try {
        return { plaintext: decryptWith(key, ivB64, tagB64, dataB64), usedPreviousKey: true };
      } catch {
        // try the next retired key
      }
    }
    throw err;
  }
}

export async function decryptSecret(payload: string): Promise<string> {
  return (await decryptSecretWithKeyInfo(payload)).plaintext;
}

/** Re-encrypts a stored value under the current key (a no-op in effect if it already uses it). */
export async function reencryptSecret(payload: string): Promise<{ payload: string; rotated: boolean }> {
  const { plaintext, usedPreviousKey } = await decryptSecretWithKeyInfo(payload);
  return usedPreviousKey ? { payload: await encryptSecret(plaintext), rotated: true } : { payload, rotated: false };
}
