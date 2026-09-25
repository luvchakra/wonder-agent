import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError, type AgentApiKey, type AgentApiKeyStatus, type AgentKeyPrincipal } from "@/lib/shared/types/foundation";

/**
 * FOUNDATION-P0-17 — per-agent API keys, the machine credential an AI agent
 * presents to the Runtime Gateway (user decision, 2026-09-25).
 *
 * - The secret is 32 random bytes, shown to the operator once and never
 *   stored. Only its SHA-256 hash and a short display prefix are kept.
 * - Each key is bound to one tenant and one agent. verifyAgentApiKey()
 *   returns those from the key row, so a gateway caller can never choose
 *   its own tenant or agent (non-negotiable #2).
 * - agent_api_keys has RLS on and no client policies (migration 0061), so
 *   every function here uses the service-role client and checks tenant_id
 *   on every row it touches, in plain sight (CLAUDE.md §14).
 * - Create and revoke are audited (#11). The secret, and its hash, never
 *   go into audit metadata or logs (#10).
 *
 * Callers are responsible for authorization (requirePermission) before
 * calling create/list/revoke. verifyAgentApiKey() is the authentication
 * step itself.
 */

export const AGENT_KEY_PREFIX = "wa_ak_";
/** Prefix + 43 base64url characters (32 bytes). */
const KEY_PATTERN = /^wa_ak_[A-Za-z0-9_-]{43}$/;
/** last_used_at is refreshed at most this often, so the hot path is not a write per request. */
const LAST_USED_REFRESH_MS = 60_000;

export function hashAgentApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function isWellFormedAgentApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** A fresh secret, its display prefix and its hash. Pure apart from the randomness. */
export function generateAgentApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = AGENT_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { secret, prefix: secret.slice(0, AGENT_KEY_PREFIX.length + 6), hash: hashAgentApiKey(secret) };
}

/** The key from an `Authorization: Bearer <key>` header, or null. */
export function bearerAgentKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return match ? match[1] : null;
}

type KeyRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

export function agentApiKeyStatus(row: Pick<KeyRow, "revoked_at" | "expires_at">, now: Date): AgentApiKeyStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  return "active";
}

function toAgentApiKey(row: KeyRow, now: Date): AgentApiKey {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    status: agentApiKeyStatus(row, now),
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

const PUBLIC_COLUMNS =
  "id, tenant_id, agent_id, name, key_prefix, key_hash, created_by, created_at, expires_at, last_used_at, revoked_at, revoked_reason";

async function assertAgentInTenant(tenantId: string, agentId: string): Promise<void> {
  const { data, error } = await supabaseServiceRole()
    .from("agents")
    .select("id, tenant_id")
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "AGENT_NOT_FOUND");
}

/**
 * Issues a key for an agent in the caller's tenant. Returns the secret
 * exactly once; it cannot be retrieved again.
 */
export async function createAgentApiKey(
  tenantId: string,
  actorId: string,
  agentId: string,
  input: { name: string; expiresAt?: string | null },
): Promise<{ key: AgentApiKey; secret: string }> {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new ApiError(422, "INVALID_NAME", "Key name must be 1–80 characters");
  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const when = new Date(input.expiresAt);
    if (Number.isNaN(when.getTime()) || when <= new Date()) {
      throw new ApiError(422, "INVALID_EXPIRY", "Expiry must be a date in the future");
    }
    expiresAt = when.toISOString();
  }

  await assertAgentInTenant(tenantId, agentId);

  const { secret, prefix, hash } = generateAgentApiKey();
  const { data, error } = await supabaseServiceRole()
    .from("agent_api_keys")
    .insert({ tenant_id: tenantId, agent_id: agentId, name, key_prefix: prefix, key_hash: hash, created_by: actorId, expires_at: expiresAt })
    .select(PUBLIC_COLUMNS)
    .single<KeyRow>();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create key");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent_api_key.created",
    objectType: "agent_api_key",
    objectId: data.id,
    outcome: "success",
    metadata: { agentId, name, keyPrefix: prefix, expiresAt },
  });

  return { key: toAgentApiKey(data, new Date()), secret };
}

export async function listAgentApiKeys(tenantId: string, agentId: string): Promise<AgentApiKey[]> {
  const { data, error } = await supabaseServiceRole()
    .from("agent_api_keys")
    .select(PUBLIC_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const now = new Date();
  // Service-role read: re-check every row's tenant before it leaves here.
  return ((data ?? []) as KeyRow[]).filter((r) => r.tenant_id === tenantId).map((r) => toAgentApiKey(r, now));
}

/** Revokes a key immediately. Revoking an already-revoked key is a no-op that still succeeds. */
export async function revokeAgentApiKey(
  tenantId: string,
  actorId: string,
  agentId: string,
  keyId: string,
  reason: string,
): Promise<AgentApiKey> {
  const supabase = supabaseServiceRole();
  const { data: existing, error: readError } = await supabase
    .from("agent_api_keys")
    .select(PUBLIC_COLUMNS)
    .eq("id", keyId)
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .maybeSingle<KeyRow>();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!existing || existing.tenant_id !== tenantId || existing.agent_id !== agentId) {
    throw new ApiError(404, "KEY_NOT_FOUND");
  }
  if (existing.revoked_at) return toAgentApiKey(existing, new Date());

  const { data, error } = await supabase
    .from("agent_api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorId, revoked_reason: reason.trim() || null })
    .eq("id", keyId)
    .eq("tenant_id", tenantId)
    .select(PUBLIC_COLUMNS)
    .single<KeyRow>();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to revoke key");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "agent_api_key.revoked",
    objectType: "agent_api_key",
    objectId: keyId,
    outcome: "success",
    metadata: { agentId, keyPrefix: existing.key_prefix, reason: reason.trim() || null },
  });

  return toAgentApiKey(data, new Date());
}

/**
 * Authenticates a presented key. Returns the tenant and agent the key is
 * bound to, or null for anything that is not a valid, active key of an
 * active tenant: malformed, unknown, revoked, expired, or belonging to a
 * suspended tenant. Callers must treat null as "unauthenticated" and deny
 * (fail-safe, §17.4). It never throws for a bad key, only for an
 * infrastructure failure, and that must also be treated as deny.
 */
export async function verifyAgentApiKey(presented: string | null | undefined, now = new Date()): Promise<AgentKeyPrincipal | null> {
  if (!presented || !isWellFormedAgentApiKey(presented)) return null;
  const hash = hashAgentApiKey(presented);
  const supabase = supabaseServiceRole();

  const { data: row, error } = await supabase
    .from("agent_api_keys")
    .select("id, tenant_id, agent_id, key_hash, expires_at, last_used_at, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle<Pick<KeyRow, "id" | "tenant_id" | "agent_id" | "key_hash" | "expires_at" | "last_used_at" | "revoked_at">>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!row) return null;
  // Belt and braces: the index lookup already matched, but compare in
  // constant time so a partial-match timing signal can never exist.
  if (!timingSafeEqual(Buffer.from(row.key_hash, "hex"), Buffer.from(hash, "hex"))) return null;
  if (agentApiKeyStatus(row, now) !== "active") return null;

  // The key's tenant must still be active, and its agent must still exist
  // in that same tenant (a suspended tenant's keys stop working at once).
  const [{ data: tenant, error: tenantError }, { data: agent, error: agentError }] = await Promise.all([
    supabase.from("tenants").select("id, status").eq("id", row.tenant_id).maybeSingle<{ id: string; status: string }>(),
    supabase
      .from("agents")
      .select("id, tenant_id")
      .eq("id", row.agent_id)
      .eq("tenant_id", row.tenant_id)
      .maybeSingle<{ id: string; tenant_id: string }>(),
  ]);
  if (tenantError) throw new ApiError(500, "QUERY_FAILED", tenantError.message);
  if (agentError) throw new ApiError(500, "QUERY_FAILED", agentError.message);
  if (!tenant || tenant.status !== "active") return null;
  if (!agent || agent.tenant_id !== row.tenant_id) return null;

  if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > LAST_USED_REFRESH_MS) {
    const { error: touchError } = await supabase
      .from("agent_api_keys")
      .update({ last_used_at: now.toISOString() })
      .eq("id", row.id)
      .eq("tenant_id", row.tenant_id);
    // Bookkeeping only: a failed touch must not turn a valid key into a denial.
    if (touchError) console.error("agent_api_keys last_used_at update failed", { keyId: row.id, error: touchError.message });
  }

  return { keyId: row.id, tenantId: row.tenant_id, agentId: row.agent_id };
}
