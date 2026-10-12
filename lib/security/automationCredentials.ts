import "server-only";

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { supabaseServiceRole, supabaseSignInClient } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { runAfterResponse } from "@/lib/shared/afterResponse";
import { decryptSecret, encryptSecret } from "@/lib/security/encryptSecret";
import { assignRole, removeRole } from "@/lib/rbac/roles";
import { TENANT_WIDE, type AssignmentTerms } from "@/lib/rbac/assignmentRules";
import { rolesWithPermissions } from "@/lib/users/users";
import { ApiError } from "@/lib/shared/types/foundation";
import {
  DEFAULT_RATE_LIMIT,
  firstOverRateLimit,
  MAX_RATE_LIMIT,
  automationBearer,
  credentialState,
  expiryFrom,
  generateAutomationKey,
  hashAutomationKey,
  isWellFormedAutomationKey,
  overRateLimit,
  trustedClientIp,
  parseCidrs,
  roleEscalation,
  refusalAuditDue,
  refusalFor,
  type CredentialState,
  type CredentialStatus,
} from "./automationCredentialRules";

/**
 * FOUNDATION-P0-31 — automation credentials for the administration API
 * (design §8.2, decision D11, approved 2026-10-12).
 *
 * A pipeline or an ITSM calls /api/v1/* with `Authorization: Bearer
 * wa_ac_…`. Each credential belongs to an APPLICATION identity of the
 * organization and acts through a backing member of its own (an
 * 'automation' membership): the roles assigned to the credential are that
 * member's roles, so RLS, getTenantContext() and the authorization engine
 * (scoped assignments, policies) apply unchanged and the tenant comes from
 * the credential's row, never from the request (non-negotiable #2).
 *
 * - The secret is shown once; only its SHA-256 hash and a prefix are kept.
 * - The backing member can never sign in interactively: its password is
 *   random, stored encrypted (encryptSecret) and never shown, and the
 *   proxy refuses its cookie sessions. The server signs it in, in memory,
 *   only after the credential itself has been verified.
 * - Created 'pending'; a second person approves (four-eyes, also a
 *   database constraint). Extending is four-eyes too.
 * - Every call is audited with the backing member as actor and the
 *   identity's owner as on-behalf-of (#11).
 *
 * automation_credentials has no client write policy (migration 0126), so
 * writes use the service role and pin every row to the verified tenant in
 * plain sight (§14). Callers check `automation.manage` first.
 */

type Row = {
  id: string;
  tenant_id: string;
  identity_id: string;
  backing_user_id: string;
  name: string;
  key_prefix: string;
  status: CredentialStatus;
  expires_at: string;
  requested_expires_at: string | null;
  extension_requested_by: string | null;
  allowed_cidrs: string[];
  rate_limit_per_minute: number;
  created_by: string;
  approved_by: string | null;
  /** WID-H06: who last gave the credential a role; cannot approve it. */
  changed_by: string | null;
  approved_at: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_used_at: string | null;
  created_at: string;
};

const COLUMNS =
  "id, tenant_id, identity_id, backing_user_id, name, key_prefix, status, expires_at, requested_expires_at, extension_requested_by, allowed_cidrs, rate_limit_per_minute, created_by, approved_by, changed_by, approved_at, revoked_by, revoked_at, revoked_reason, last_used_at, created_at";

export type AutomationCredential = {
  id: string;
  name: string;
  keyPrefix: string;
  state: CredentialState;
  identity: { id: string; name: string; ownerIdentityId: string | null };
  roles: { role: string; displayName: string }[];
  expiresAt: string;
  requestedExpiresAt: string | null;
  extensionRequestedBy: { id: string; name: string } | null;
  allowedCidrs: string[];
  rateLimitPerMinute: number;
  createdBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

/** The backing member's sign-in address. `.invalid` is reserved: nothing is ever delivered there. */
const backingEmail = (credentialId: string) => `automation-${credentialId}@automation.invalid`;

// ------------------------------------------------------------- console

export async function listAutomationCredentials(tenantId: string): Promise<AutomationCredential[]> {
  const db = supabaseServiceRole();
  const { data, error } = await db.from("automation_credentials").select(COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId);
  if (!rows.length) return [];

  const people = [...new Set(rows.flatMap((r) => [r.created_by, r.approved_by, r.extension_requested_by]).filter((x): x is string => !!x))];
  const [identities, users, roles] = await Promise.all([
    db.from("identities").select("id, tenant_id, display_name, owner_identity_id").eq("tenant_id", tenantId).in("id", [...new Set(rows.map((r) => r.identity_id))]),
    db.from("users").select("id, email, display_name").in("id", people),
    db.from("user_roles").select("user_id, tenant_id, roles(name, display_name)").eq("tenant_id", tenantId).in("user_id", rows.map((r) => r.backing_user_id)),
  ]);
  if (identities.error || users.error || roles.error) throw new ApiError(500, "QUERY_FAILED", (identities.error ?? users.error ?? roles.error)!.message);
  const idOf = new Map(
    ((identities.data ?? []) as { id: string; tenant_id: string; display_name: string; owner_identity_id: string | null }[]).filter((i) => i.tenant_id === tenantId).map((i) => [i.id, i]),
  );
  const nameOf = new Map(((users.data ?? []) as { id: string; email: string | null; display_name: string | null }[]).map((u) => [u.id, u.display_name || u.email || "A former member"]));
  const person = (id: string | null) => (id ? { id, name: nameOf.get(id) ?? "A former member" } : null);
  const rolesOf = new Map<string, { role: string; displayName: string }[]>();
  for (const r of (roles.data ?? []) as unknown as { user_id: string; tenant_id: string; roles: { name: string; display_name: string } | null }[]) {
    if (r.tenant_id !== tenantId || !r.roles) continue;
    rolesOf.set(r.user_id, [...(rolesOf.get(r.user_id) ?? []), { role: r.roles.name, displayName: r.roles.display_name }]);
  }
  const now = new Date();
  return rows.map((r) => {
    const identity = idOf.get(r.identity_id);
    return {
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      state: credentialState(r, now),
      identity: { id: r.identity_id, name: identity?.display_name ?? "Unknown identity", ownerIdentityId: identity?.owner_identity_id ?? null },
      roles: rolesOf.get(r.backing_user_id) ?? [],
      expiresAt: r.expires_at,
      requestedExpiresAt: r.requested_expires_at,
      extensionRequestedBy: person(r.extension_requested_by),
      allowedCidrs: r.allowed_cidrs,
      rateLimitPerMinute: r.rate_limit_per_minute,
      createdBy: person(r.created_by)!,
      approvedBy: person(r.approved_by),
      approvedAt: r.approved_at,
      revokedAt: r.revoked_at,
      revokedReason: r.revoked_reason,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    };
  });
}

async function loadRow(tenantId: string, id: string): Promise<Row> {
  const { data, error } = await supabaseServiceRole().from("automation_credentials").select(COLUMNS).eq("id", id).eq("tenant_id", tenantId).maybeSingle<Row>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such automation credential");
  return data;
}

async function update(tenantId: string, id: string, fields: Record<string, unknown>, expectStatus?: CredentialStatus): Promise<Row> {
  let q = supabaseServiceRole()
    .from("automation_credentials")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (expectStatus) q = q.eq("status", expectStatus);
  const { data, error } = await q.select(COLUMNS).maybeSingle<Row>();
  if (error) {
    if (error.code === "23514" && error.message.includes("four_eyes")) throw new ApiError(403, "FOUR_EYES", "Someone other than its creator must approve a credential");
    throw new ApiError(500, "UPDATE_FAILED", error.message);
  }
  if (!data) throw new ApiError(409, "CONFLICT", "The credential changed meanwhile; reload and try again");
  return data;
}

async function setMembership(tenantId: string, userId: string, actorId: string, status: "active" | "suspended" | "deactivated", reason: string | null) {
  const { error } = await supabaseServiceRole()
    .from("tenant_memberships")
    .update({ status, status_reason: reason, status_changed_by: actorId, status_changed_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("account_type", "automation");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
}

async function audit(tenantId: string, actorId: string, action: string, row: Pick<Row, "id" | "identity_id" | "key_prefix">, metadata: Record<string, unknown> = {}, outcome: "success" | "failure" = "success") {
  // Never the secret or its hash (#10).
  await writeAudit({ tenantId, actorId, actorType: "user", action, objectType: "automation_credential", objectId: row.id, outcome, metadata: { identityId: row.identity_id, keyPrefix: row.key_prefix, ...metadata } });
}

/** Roles the actor may give a credential: existing, active, and within the actor's own permissions (never automation.manage). */
async function checkRoles(tenantId: string, actorPermissions: readonly string[], names: string[]) {
  const found = await rolesWithPermissions(tenantId, names);
  const missing = names.filter((n) => !found.some((r) => r.name === n));
  if (missing.length) throw new ApiError(400, "UNKNOWN_ROLE", `Unknown role: ${missing.join(", ")}`);
  const escalated = roleEscalation(found.flatMap((r) => r.permissions), actorPermissions);
  if (escalated.length) throw new ApiError(403, "ROLE_ESCALATION", `A credential can only be given permissions you hold, and never automation.manage. Not allowed: ${escalated.join(", ")}`);
}

export type CreateInput = { name?: unknown; identityId?: unknown; roles?: unknown; expiresInDays?: unknown; allowedCidrs?: unknown; rateLimitPerMinute?: unknown };

/**
 * Creates a pending credential and its backing member, with the chosen
 * roles. Returns the secret exactly once. It works only after someone
 * else approves it.
 */
export async function createAutomationCredential(
  tenantId: string,
  actor: { userId: string; permissions: readonly string[] },
  input: CreateInput,
): Promise<{ credential: AutomationCredential; secret: string }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 120) throw new ApiError(400, "VALIDATION", "Name must be 1–120 characters");
  const now = new Date();
  const expiry = expiryFrom(input.expiresInDays, now);
  if (!expiry.ok) throw new ApiError(400, "VALIDATION", expiry.message);
  const cidrs = parseCidrs(input.allowedCidrs);
  if (!cidrs.ok) throw new ApiError(400, "VALIDATION", cidrs.message);
  const rate = input.rateLimitPerMinute === undefined || input.rateLimitPerMinute === null || input.rateLimitPerMinute === "" ? DEFAULT_RATE_LIMIT : Number(input.rateLimitPerMinute);
  if (!Number.isInteger(rate) || rate < 1 || rate > MAX_RATE_LIMIT) throw new ApiError(400, "VALIDATION", `Rate limit must be 1 to ${MAX_RATE_LIMIT} calls a minute`);
  const roles = Array.isArray(input.roles) ? [...new Set(input.roles.filter((r): r is string => typeof r === "string" && r.length > 0))] : typeof input.roles === "string" && input.roles ? [input.roles] : [];
  if (!roles.length) throw new ApiError(400, "VALIDATION", "Choose at least one role");
  if (typeof input.identityId !== "string") throw new ApiError(400, "VALIDATION", "Choose the application identity it belongs to");

  const db = supabaseServiceRole();
  const { data: identity, error: identityError } = await db
    .from("identities")
    .select("id, tenant_id, identity_type, status")
    .eq("id", input.identityId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; tenant_id: string; identity_type: string; status: string }>();
  if (identityError) throw new ApiError(500, "QUERY_FAILED", identityError.message);
  if (!identity || identity.tenant_id !== tenantId) throw new ApiError(404, "IDENTITY_NOT_FOUND", "No such identity");
  if (identity.identity_type !== "APPLICATION") throw new ApiError(400, "VALIDATION", "A credential belongs to an application identity");
  if (identity.status !== "active") throw new ApiError(409, "IDENTITY_INACTIVE", "The application identity is not active");

  await checkRoles(tenantId, actor.permissions, roles);

  const id = randomUUID();
  const key = generateAutomationKey();
  const password = randomBytes(32).toString("base64url");
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: backingEmail(id),
    password,
    email_confirm: true,
    app_metadata: { automation: true },
    user_metadata: { display_name: `Automation: ${name}` },
  });
  if (createError || !created.user) throw new ApiError(500, "CREATE_FAILED", "The credential could not be created. Nothing was changed.");
  const backingUserId = created.user.id;

  try {
    await db.from("users").update({ display_name: `Automation: ${name}` }).eq("id", backingUserId);
    const { error: insertError } = await db.from("automation_credentials").insert({
      id,
      tenant_id: tenantId,
      identity_id: identity.id,
      backing_user_id: backingUserId,
      backing_secret_enc: await encryptSecret(password),
      name,
      key_prefix: key.prefix,
      key_hash: key.hash,
      expires_at: expiry.expiresAt.toISOString(),
      allowed_cidrs: cidrs.cidrs,
      rate_limit_per_minute: rate,
      created_by: actor.userId,
    });
    if (insertError) throw new ApiError(500, "CREATE_FAILED", insertError.message);
    const nowIso = now.toISOString();
    const { error: memberError } = await db.from("tenant_memberships").insert({
      tenant_id: tenantId,
      user_id: backingUserId,
      status: "suspended",
      status_reason: "Awaiting approval",
      status_changed_by: actor.userId,
      status_changed_at: nowIso,
      invited_by: actor.userId,
      invited_at: nowIso,
      account_type: "automation",
    });
    if (memberError) throw new ApiError(500, "CREATE_FAILED", memberError.message);
    for (const role of roles) await assignRole(tenantId, actor.userId, backingUserId, role, TENANT_WIDE, { automation: true });
  } catch (err) {
    // Nothing half-made is left behind: the account's rows go with it (on delete cascade).
    await db.auth.admin.deleteUser(backingUserId).catch(() => undefined);
    throw err;
  }

  await audit(tenantId, actor.userId, "automation_credential.created", { id, identity_id: identity.id, key_prefix: key.prefix }, {
    name,
    roles,
    expiresAt: expiry.expiresAt.toISOString(),
    allowedCidrs: cidrs.cidrs,
    rateLimitPerMinute: rate,
  });
  const credential = (await listAutomationCredentials(tenantId)).find((c) => c.id === id);
  if (!credential) throw new ApiError(500, "CREATE_FAILED", "The credential was created but could not be read back");
  return { credential, secret: key.secret };
}

/** Four-eyes: someone other than the creator turns a pending credential on. */
export async function approveAutomationCredential(tenantId: string, actorId: string, id: string): Promise<void> {
  const row = await loadRow(tenantId, id);
  if (row.status !== "pending") throw new ApiError(409, "NOT_PENDING", "Only a pending credential can be approved");
  if (row.created_by === actorId || row.changed_by === actorId) {
    await audit(tenantId, actorId, "automation_credential.approved", row, { refused: "FOUR_EYES" }, "failure");
    throw new ApiError(403, "FOUR_EYES", "Someone other than its creator, or whoever last gave it a role, must approve a credential");
  }
  if (new Date(row.expires_at) <= new Date()) throw new ApiError(409, "EXPIRED", "This credential expired before it was approved; create a new one");
  await update(tenantId, id, { status: "active", approved_by: actorId, approved_at: new Date().toISOString() }, "pending");
  await setMembership(tenantId, row.backing_user_id, actorId, "active", null);
  await audit(tenantId, actorId, "automation_credential.approved", row, { createdBy: row.created_by });
}

/** Asks for a new expiry, `days` from now (at most a year). Someone else approves it. */
export async function requestAutomationCredentialExtension(tenantId: string, actorId: string, id: string, days: unknown): Promise<void> {
  const row = await loadRow(tenantId, id);
  if (row.status !== "active") throw new ApiError(409, "NOT_ACTIVE", "Only an approved credential can be extended");
  const expiry = expiryFrom(days, new Date());
  if (!expiry.ok) throw new ApiError(400, "VALIDATION", expiry.message);
  await update(tenantId, id, { requested_expires_at: expiry.expiresAt.toISOString(), extension_requested_by: actorId }, "active");
  await audit(tenantId, actorId, "automation_credential.extension_requested", row, { requestedExpiresAt: expiry.expiresAt.toISOString(), currentExpiresAt: row.expires_at });
}

/** Four-eyes: someone other than the requester applies the requested expiry. */
export async function approveAutomationCredentialExtension(tenantId: string, actorId: string, id: string): Promise<void> {
  const row = await loadRow(tenantId, id);
  if (row.status !== "active" || !row.requested_expires_at || !row.extension_requested_by) throw new ApiError(409, "NO_EXTENSION", "No extension is waiting for approval");
  if (row.extension_requested_by === actorId) {
    await audit(tenantId, actorId, "automation_credential.extended", row, { refused: "FOUR_EYES" }, "failure");
    throw new ApiError(403, "FOUR_EYES", "Someone other than the requester must approve an extension");
  }
  await update(tenantId, id, { expires_at: row.requested_expires_at, requested_expires_at: null, extension_requested_by: null }, "active");
  await audit(tenantId, actorId, "automation_credential.extended", row, { from: row.expires_at, to: row.requested_expires_at, requestedBy: row.extension_requested_by });
}

/** Stops the credential at once and ends its backing member's sessions. Revoking twice is a no-op. */
export async function revokeAutomationCredential(tenantId: string, actorId: string, id: string, reason: unknown): Promise<void> {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why || why.length > 500) throw new ApiError(400, "VALIDATION", "A reason (up to 500 characters) is required");
  const row = await loadRow(tenantId, id);
  if (row.status === "revoked") return;
  await update(tenantId, id, { status: "revoked", revoked_by: actorId, revoked_at: new Date().toISOString(), revoked_reason: why, requested_expires_at: null, extension_requested_by: null });
  tokenCache.delete(id);
  await setMembership(tenantId, row.backing_user_id, actorId, "deactivated", "Credential revoked");
  const { error } = await supabaseServiceRole().rpc("revoke_user_sessions", { p_user: row.backing_user_id });
  if (error) console.error("automation credential sessions not ended", { credentialId: id, error: error.message });
  await audit(tenantId, actorId, "automation_credential.revoked", row, { reason: why });
}

/** A new secret for the same credential; the old one stops working at once. Returned once. */
export async function rotateAutomationCredential(tenantId: string, actorId: string, id: string): Promise<{ secret: string; keyPrefix: string }> {
  const row = await loadRow(tenantId, id);
  if (row.status === "revoked") throw new ApiError(409, "REVOKED", "A revoked credential cannot be rotated");
  const key = generateAutomationKey();
  await update(tenantId, id, { key_hash: key.hash, key_prefix: key.prefix }, row.status);
  await audit(tenantId, actorId, "automation_credential.rotated", { ...row, key_prefix: key.prefix }, { previousKeyPrefix: row.key_prefix });
  return { secret: key.secret, keyPrefix: key.prefix };
}

/** Gives the credential a role (optionally scoped, FOUNDATION-P0-19), within the actor's own permissions. */
export async function assignAutomationCredentialRole(
  tenantId: string,
  actor: { userId: string; permissions: readonly string[] },
  id: string,
  role: string,
  terms: AssignmentTerms = TENANT_WIDE,
): Promise<void> {
  const row = await loadRow(tenantId, id);
  if (row.status === "revoked") throw new ApiError(409, "REVOKED", "A revoked credential cannot be changed");
  await checkRoles(tenantId, actor.permissions, [role]);
  // WID-H06 (owner decision 2026-10-12): more power needs a second person. An
  // approved credential goes back to pending, and stops working, until
  // someone other than the person giving the role approves it.
  if (row.status === "active") {
    await update(tenantId, id, { status: "pending", approved_by: null, approved_at: null, changed_by: actor.userId }, "active");
    tokenCache.delete(id);
    await setMembership(tenantId, row.backing_user_id, actor.userId, "deactivated", "Role change waiting for approval");
    const { error } = await supabaseServiceRole().rpc("revoke_user_sessions", { p_user: row.backing_user_id });
    if (error) console.error("automation credential sessions not ended", { credentialId: id, error: error.message });
  } else {
    await update(tenantId, id, { changed_by: actor.userId }, row.status);
  }
  await assignRole(tenantId, actor.userId, row.backing_user_id, role, terms, { automation: true });
  await audit(tenantId, actor.userId, "automation_credential.role_change_requested", row, { role, pausedUntilApproved: row.status === "active" });
}

export async function removeAutomationCredentialRole(tenantId: string, actorId: string, id: string, role: string): Promise<void> {
  const row = await loadRow(tenantId, id);
  await removeRole(tenantId, actorId, row.backing_user_id, role, { automation: true });
}

/** For the console's form: the organization's active application identities. */
export async function listApplicationIdentities(tenantId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabaseServiceRole()
    .from("identities")
    .select("id, tenant_id, display_name")
    .eq("tenant_id", tenantId)
    .eq("identity_type", "APPLICATION")
    .eq("status", "active")
    .order("display_name")
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as { id: string; tenant_id: string; display_name: string }[]).filter((i) => i.tenant_id === tenantId).map((i) => ({ id: i.id, name: i.display_name }));
}

/** For the console's form: the roles this actor may give a credential (within their own permissions, never automation.manage). */
export async function listGivableRoles(tenantId: string, actorPermissions: readonly string[], roles: { name: string; displayName: string }[]): Promise<{ name: string; displayName: string }[]> {
  const withPermissions = await rolesWithPermissions(tenantId, roles.map((r) => r.name));
  const givable = new Set(withPermissions.filter((r) => roleEscalation(r.permissions, actorPermissions).length === 0).map((r) => r.name));
  return roles.filter((r) => givable.has(r.name));
}

// ------------------------------------------------------------- request path

type Lookup =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "found"; row: Row & { backing_secret_enc: string; key_hash: string }; tenantStatus: string | null; ownerIdentityId: string | null };

/**
 * Once per request. React's cache() does not memoize in route handlers,
 * and the check has side effects (the rate-limit count, the audit entry),
 * so results are held by the request id proxy.ts stamps on every
 * automation call. Bounded; oldest dropped first. Without an id (no
 * automation bearer reached the proxy) nothing is held.
 */
const MEMO_MAX = 1_000;
const memo = new Map<string, Promise<unknown>>();

async function oncePerRequest<T>(name: string, work: () => Promise<T>): Promise<T> {
  let id: string | null = null;
  try {
    id = (await headers()).get("x-wonderid-request-id");
  } catch {
    // outside a request
  }
  if (!id) return work();
  const key = `${name}:${id}`;
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  while (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  const value = work();
  memo.set(key, value);
  return value;
}

/**
 * The automation credential this request presents, looked up once per
 * request. `none` when the request carries no `wa_ac_` bearer at all.
 * Uses a service-role client that sends no actor header, because the
 * actor is what is being resolved (lib/security/actorHeader.ts).
 */
const lookupCredential = (): Promise<Lookup> => oncePerRequest("lookup", lookupCredentialNow);

async function lookupCredentialNow(): Promise<Lookup> {
  let presented: string | null;
  try {
    presented = automationBearer((await headers()).get("authorization"));
  } catch {
    return { kind: "none" }; // outside a request
  }
  if (!presented) return { kind: "none" };
  if (!isWellFormedAutomationKey(presented)) return { kind: "invalid" };
  const hash = hashAutomationKey(presented);
  const { data, error } = await supabaseServiceRole({ actor: false })
    .from("automation_credentials")
    .select(`${COLUMNS}, key_hash, backing_secret_enc, tenants(status), identities(owner_identity_id)`)
    .eq("key_hash", hash)
    .maybeSingle<Row & { key_hash: string; backing_secret_enc: string; tenants: { status: string } | null; identities: { owner_identity_id: string | null } | null }>();
  if (error) throw new ApiError(503, "AUTH_UNAVAILABLE", "Credentials could not be checked; try again shortly");
  if (!data || !timingSafeEqual(Buffer.from(data.key_hash, "hex"), Buffer.from(hash, "hex"))) return { kind: "invalid" };
  return { kind: "found", row: data, tenantStatus: data.tenants?.status ?? null, ownerIdentityId: data.identities?.owner_identity_id ?? null };
}

/** For the actor header: undefined when the request is not an automation call; else its backing member (null when unknown). */
export async function automationActorId(): Promise<string | null | undefined> {
  const found = await lookupCredential();
  if (found.kind === "none") return undefined;
  return found.kind === "found" ? found.row.backing_user_id : null;
}

/**
 * Backing members' access tokens, held in memory until a minute before
 * they expire. Keyed by credential id, bounded; a credential is verified
 * on every call before its token is used, so a revoked or expired one
 * never reaches this cache.
 */
const TOKEN_CACHE_MAX = 1_000;
const tokenCache = new Map<string, { token: string; userId: string; until: number }>();

async function backingToken(row: Row & { backing_secret_enc: string }): Promise<string> {
  const hit = tokenCache.get(row.id);
  if (hit && hit.userId === row.backing_user_id && hit.until > Date.now()) return hit.token;
  const password = await decryptSecret(row.backing_secret_enc);
  const { data, error } = await supabaseSignInClient().auth.signInWithPassword({ email: backingEmail(row.id), password });
  if (error || !data.session) throw new ApiError(503, "AUTH_UNAVAILABLE", "The credential could not be signed in; try again shortly");
  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value as string);
  tokenCache.set(row.id, { token: data.session.access_token, userId: row.backing_user_id, until: (data.session.expires_at ?? 0) * 1000 - 60_000 });
  return data.session.access_token;
}

const LAST_USED_REFRESH_MS = 60_000;
/** When each credential's refusal for each reason was last audited (bounded; see refusalAuditDue). */
const refusalAudits = new Map<string, number>();

/**
 * For an automation call, the backing member's access token after the
 * credential has passed every check: known hash, approved, not revoked or
 * expired, organization active, source address allowed, under its rate
 * limit. Null for a request without an automation bearer. Throws ApiError
 * (401, 403, 429, 503) otherwise; never falls back to a cookie session.
 * Each allowed call is audited (#11), and so is a refusal: once per
 * credential and reason a minute, and the first call over the rate limit
 * in each minute (WID-H06).
 */
export const getAutomationAccess = (): Promise<{ accessToken: string; userId: string } | null> => oncePerRequest("access", automationAccessNow);

async function automationAccessNow(): Promise<{ accessToken: string; userId: string } | null> {
  const found = await lookupCredential();
  if (found.kind === "none") return null;
  if (found.kind === "invalid") throw new ApiError(401, "UNAUTHENTICATED", "Invalid credential");
  const { row } = found;
  const h = await headers();
  // WID-H08: only a header the platform's edge sets; never the caller's own x-forwarded-for.
  const ip = trustedClientIp((name) => h.get(name), { CLIENT_IP_HEADER: process.env.CLIENT_IP_HEADER, VERCEL: process.env.VERCEL });
  const request = h.get("x-wonderid-request") ?? "";
  const [method, path] = request.split(" ");
  const now = new Date();

  const refused = (code: string) =>
    writeAudit({
      tenantId: row.tenant_id,
      actorId: row.backing_user_id,
      actorType: "integration",
      action: "automation.api_call",
      objectType: "automation_credential",
      objectId: row.id,
      outcome: "failure",
      metadata: { credentialId: row.id, onBehalfOf: row.identity_id, ownerIdentityId: found.ownerIdentityId, method, path, refused: code },
    });

  const refusal = refusalFor({ ...row, tenant_status: found.tenantStatus }, ip, now);
  if (refusal) {
    // WID-H06: every reason is audited (pending, revoked, expired, address), once per credential and reason a minute.
    if (refusalAuditDue(refusalAudits, `${row.id}:${refusal.code}`, now.getTime())) await refused(refusal.code);
    throw new ApiError(refusal.status, refusal.code, refusal.message);
  }

  const { data: calls, error: hitError } = await supabaseServiceRole().rpc("automation_credential_hit", { p_credential: row.id, p_tenant: row.tenant_id });
  if (hitError) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "The call could not be counted; try again shortly");
  if (overRateLimit(Number(calls), row.rate_limit_per_minute)) {
    if (firstOverRateLimit(Number(calls), row.rate_limit_per_minute)) await refused("RATE_LIMITED");
    throw new ApiError(429, "RATE_LIMITED", `More than ${row.rate_limit_per_minute} calls this minute`);
  }

  const accessToken = await backingToken(row);
  await writeAudit({
    tenantId: row.tenant_id,
    actorId: row.backing_user_id,
    actorType: "integration",
    action: "automation.api_call",
    objectType: "automation_credential",
    objectId: row.id,
    outcome: "success",
    metadata: { credentialId: row.id, onBehalfOf: row.identity_id, ownerIdentityId: found.ownerIdentityId, method, path },
  });

  if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > LAST_USED_REFRESH_MS) {
    runAfterResponse(async () => {
      const { error } = await supabaseServiceRole({ actor: false }).from("automation_credentials").update({ last_used_at: now.toISOString() }).eq("id", row.id).eq("tenant_id", row.tenant_id);
      if (error) console.error("automation_credentials last_used_at update failed", { credentialId: row.id, error: error.message });
    });
  }
  return { accessToken, userId: row.backing_user_id };
}

/**
 * WID-H06 (owner decision 2026-10-12): a decision that must be a person's
 * (approving access, certifying) is refused for an automation credential's
 * call, whatever permissions its roles carry.
 */
export async function refuseAutomationCaller(what: string): Promise<void> {
  if (await getAutomationAccess()) throw new ApiError(403, "HUMAN_DECISION_REQUIRED", `${what} is a person's decision; an automation credential cannot make it`);
}

