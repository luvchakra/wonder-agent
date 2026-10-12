import { createHash, randomBytes } from "node:crypto";
import { BlockList, isIP } from "node:net";

/**
 * FOUNDATION-P0-31 — the pure rules of automation credentials (design
 * §8.2, decision D11): the secret's shape, its expiry, its source-address
 * allowlist, and whether a presented credential may be used now. No I/O;
 * the database enforces four-eyes again (migration 0126), so a bug here is
 * never the only guard.
 */

export const AUTOMATION_KEY_PREFIX = "wa_ac_";
/** Prefix + 43 base64url characters (32 bytes). */
const KEY_PATTERN = /^wa_ac_[A-Za-z0-9_-]{43}$/;

export const DEFAULT_EXPIRY_DAYS = 90;
export const MAX_EXPIRY_DAYS = 365;
export const MAX_CIDRS = 20;
export const DEFAULT_RATE_LIMIT = 120;
export const MAX_RATE_LIMIT = 10_000;

export type CredentialStatus = "pending" | "active" | "revoked";
/** What the console shows: the stored status, with an active credential past its expiry shown as expired. */
export type CredentialState = CredentialStatus | "expired";

export function hashAutomationKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function isWellFormedAutomationKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** A fresh secret, its display prefix and its hash. */
export function generateAutomationKey(): { secret: string; prefix: string; hash: string } {
  const secret = AUTOMATION_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { secret, prefix: secret.slice(0, AUTOMATION_KEY_PREFIX.length + 6), hash: hashAutomationKey(secret) };
}

/** The automation credential in an `Authorization: Bearer wa_ac_…` header, or null for anything else. */
export function automationBearer(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match && match[1].startsWith(AUTOMATION_KEY_PREFIX) ? match[1] : null;
}

/** Expiry in whole days from now: 1 to 365, 90 when not given. */
export function expiryFrom(days: unknown, now: Date): { ok: true; expiresAt: Date } | { ok: false; message: string } {
  const n = days === undefined || days === null || days === "" ? DEFAULT_EXPIRY_DAYS : Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_EXPIRY_DAYS) return { ok: false, message: `Expiry must be 1 to ${MAX_EXPIRY_DAYS} days` };
  return { ok: true, expiresAt: new Date(now.getTime() + n * 86_400_000) };
}

/** Normalizes an allowlist: each entry an IPv4/IPv6 address or CIDR block. An empty list allows any address. */
export function parseCidrs(input: unknown): { ok: true; cidrs: string[] } | { ok: false; message: string } {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,]+/) : input == null ? [] : null;
  if (!raw) return { ok: false, message: "Allowed addresses must be a list" };
  const cidrs: string[] = [];
  for (const entry of raw) {
    const s = String(entry).trim();
    if (!s) continue;
    const [addr, bits, extra] = s.split("/");
    const family = isIP(addr);
    const max = family === 4 ? 32 : 128;
    const prefix = bits === undefined ? max : Number(bits);
    if (!family || extra !== undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > max || (bits !== undefined && !/^\d+$/.test(bits))) {
      return { ok: false, message: `Not an address or CIDR block: ${s}` };
    }
    cidrs.push(`${addr}/${prefix}`);
  }
  if (cidrs.length > MAX_CIDRS) return { ok: false, message: `At most ${MAX_CIDRS} address ranges` };
  return { ok: true, cidrs: [...new Set(cidrs)] };
}

/** Whether `ip` falls in the allowlist. An empty list allows any address; an unknown address never matches a list. */
export function addressAllowed(ip: string | null, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) return true;
  if (!ip) return false;
  const address = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(address);
  if (!family) return false;
  const list = new BlockList();
  for (const c of cidrs) {
    const [addr, bits] = c.split("/");
    const f = isIP(addr);
    list.addSubnet(addr, Number(bits), f === 4 ? "ipv4" : "ipv6");
  }
  return list.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function credentialState(row: { status: CredentialStatus; expires_at: string }, now: Date): CredentialState {
  if (row.status === "active" && new Date(row.expires_at) <= now) return "expired";
  return row.status;
}

export type UseRefusal = { status: 401 | 403 | 429; code: string; message: string };

/**
 * Whether a credential found by its hash may serve this call. Null when it
 * may. Pending, revoked and expired credentials, and those of a suspended
 * organization, are 401 (the caller is not authenticated); an address
 * outside the allowlist is 403; over the per-minute limit is 429.
 */
export function refusalFor(
  row: { status: CredentialStatus; expires_at: string; allowed_cidrs: readonly string[]; tenant_status: string | null },
  ip: string | null,
  now: Date,
): UseRefusal | null {
  if (row.tenant_status !== "active") return { status: 401, code: "UNAUTHENTICATED", message: "Invalid credential" };
  const state = credentialState(row, now);
  if (state === "pending") return { status: 401, code: "CREDENTIAL_PENDING", message: "This credential has not been approved yet" };
  if (state === "revoked") return { status: 401, code: "CREDENTIAL_REVOKED", message: "This credential has been revoked" };
  if (state === "expired") return { status: 401, code: "CREDENTIAL_EXPIRED", message: "This credential has expired" };
  if (!addressAllowed(ip, row.allowed_cidrs)) return { status: 403, code: "ADDRESS_NOT_ALLOWED", message: "Calls from this address are not allowed for this credential" };
  return null;
}

export function overRateLimit(callsThisMinute: number, limit: number): boolean {
  return callsThisMinute > limit;
}

/**
 * Permissions an automation credential never holds, whatever its roles
 * (owner decision 2026-10-12, WID-H06): it must not mint or approve
 * credentials, approve access, or certify. Those are people's decisions
 * (non-negotiable #15). getTenantContext() also strips them from an
 * automation call's effective permissions.
 */
export const HUMAN_ONLY_PERMISSIONS: readonly string[] = ["automation.manage", "access.approve", "agent.certify"];

/**
 * Permissions a role would give a credential that the person assigning it
 * does not hold, plus the human-only ones, which a credential never holds.
 * Empty when the role may be assigned.
 */
export function roleEscalation(rolePermissions: readonly string[], actorPermissions: readonly string[]): string[] {
  const held = new Set(actorPermissions);
  return [...new Set(rolePermissions.filter((p) => HUMAN_ONLY_PERMISSIONS.includes(p) || !held.has(p)))].sort();
}
