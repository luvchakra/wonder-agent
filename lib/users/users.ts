import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getResendApiKey, getResendFromEmail } from "@/lib/db/env";
import { writeAudit } from "@/lib/audit/writeAudit";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { ApiError } from "@/lib/shared/types/foundation";
import { groupsOfUser, type UserGroup } from "./groups";
import {
  TRANSITIONS,
  checkRoleGrant,
  checkStatusChange,
  databaseRefusal,
  effectivePermissions,
  validateInvite,
  type AccountType,
  type AuthMethod,
  type InviteInput,
  type MembershipStatus,
  type StatusAction,
  type ValidInvite,
} from "./userRules";

/**
 * FOUNDATION-P0-23 — the organization's users and their membership
 * lifecycle (spec §5–8, 23–25, 30–34).
 *
 * Every function takes the server-resolved tenant id and the verified
 * actor (callers have already passed requirePermission for the action) and
 * writes through the service role: `tenant_memberships` and `user_roles`
 * have no client write policies, and a user's e-mail, last sign-in and
 * sessions sit outside what tenant RLS can show. So every query below is
 * filtered by `tenant_id` explicitly, and every change re-reads the
 * membership in *this* tenant first (CLAUDE.md §14). Self-protection and
 * the last-administrator rule are checked here for a clear answer, and
 * enforced again by migration 0096's constraints and triggers.
 */

export type DirectoryUser = {
  userId: string;
  email: string;
  displayName: string | null;
  status: MembershipStatus;
  accountType: AccountType;
  jobTitle: string | null;
  department: string | null;
  roles: string[];
  lastSignInAt: string | null;
  joinedAt: string;
};

export type DirectoryFilter = { q?: string; status?: string | null; role?: string | null; group?: string | null; page?: number; pageSize?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_SET = new Set(["invited", "active", "suspended", "deactivated", "removed"]);

export async function listUsers(tenantId: string, filter: DirectoryFilter): Promise<{ items: DirectoryUser[]; total: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const { data, error } = await supabaseServiceRole().rpc("tenant_user_directory", {
    p_tenant: tenantId,
    p_search: filter.q?.slice(0, 100) || null,
    p_status: filter.status && STATUS_SET.has(filter.status) ? filter.status : null,
    p_role: filter.role || null,
    p_group: filter.group && UUID.test(filter.group) ? filter.group : null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []) as {
    user_id: string;
    email: string;
    display_name: string | null;
    status: MembershipStatus;
    account_type: AccountType;
    job_title: string | null;
    department: string | null;
    roles: string[];
    last_sign_in_at: string | null;
    joined_at: string;
    total: number;
  }[];
  return {
    total: rows[0] ? Number(rows[0].total) : 0,
    items: rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      status: r.status,
      accountType: r.account_type,
      jobTitle: r.job_title,
      department: r.department,
      roles: r.roles ?? [],
      lastSignInAt: r.last_sign_in_at,
      joinedAt: r.joined_at,
    })),
  };
}

export type UserSummary = { total: number; active: number; invited: number; suspended: number; deactivated: number; administrators: number };

export async function getUserSummary(tenantId: string): Promise<UserSummary> {
  const { data, error } = await supabaseServiceRole().rpc("tenant_user_summary", { p_tenant: tenantId });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, number> | undefined;
  const n = (k: string) => Number(r?.[k] ?? 0);
  return { total: n("total"), active: n("active"), invited: n("invited"), suspended: n("suspended"), deactivated: n("deactivated"), administrators: n("administrators") };
}

type MembershipRow = {
  user_id: string;
  status: MembershipStatus;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  invited_by: string | null;
  invited_at: string | null;
  account_type: AccountType;
  auth_method: AuthMethod | null;
  created_at: string;
};

async function membershipIn(tenantId: string, userId: string): Promise<MembershipRow | null> {
  const { data, error } = await supabaseServiceRole()
    .from("tenant_memberships")
    .select("user_id, status, status_reason, status_changed_at, status_changed_by, invited_by, invited_at, account_type, auth_method, created_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data;
}

export type RoleAssignment = {
  role: string;
  displayName: string;
  description: string | null;
  /** A tenant's own role rather than a system role (FOUNDATION-P0-25). */
  custom: boolean;
  /** An inactive role is held but grants nothing. */
  active: boolean;
  grantedAt: string;
  grantedBy: { userId: string; name: string } | null;
};

export type UserDetail = {
  userId: string;
  email: string;
  displayName: string | null;
  status: MembershipStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  accountType: AccountType;
  authMethod: AuthMethod | null;
  invitedAt: string | null;
  invitedBy: { userId: string; name: string } | null;
  joinedAt: string;
  lastSignInAt: string | null;
  roles: RoleAssignment[];
  /** Groups the user is in, and the roles each gives them (FOUNDATION-P0-26). */
  groups: UserGroup[];
  /** Each effective permission and what grants it: a role, or "Role (via Group)". */
  permissions: { permission: string; roles: string[] }[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One user of this organization; null when they are not (or no longer) in it, removed included. */
type RoleAssignmentRow = {
  created_at: string;
  granted_by: string | null;
  roles: { id: string; name: string; display_name: string; description: string | null; status: string; tenant_id: string | null } | null;
};

export async function getUserDetail(tenantId: string, userId: string): Promise<UserDetail | null> {
  if (!UUID_RE.test(userId)) return null;
  const m = await membershipIn(tenantId, userId);
  if (!m) return null;
  const db = supabaseServiceRole();
  const [{ data: user }, { data: authUser }, { data: roleRows, error: rolesError }, groups] = await Promise.all([
    db.from("users").select("email, display_name").eq("id", userId).maybeSingle<{ email: string; display_name: string | null }>(),
    db.auth.admin.getUserById(userId),
    db
      .from("user_roles")
      .select("created_at, granted_by, roles(id, name, display_name, description, status, tenant_id)")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .returns<RoleAssignmentRow[]>(),
    groupsOfUser(tenantId, userId),
  ]);
  if (rolesError) throw new ApiError(500, "QUERY_FAILED", rolesError.message);
  const roles = (roleRows ?? []).filter((r) => r.roles);
  // What grants what: active direct roles by name; active roles of active groups as "Role (via Group)".
  const sources = new Map<string, string[]>();
  for (const r of roles) if (r.roles!.status === "active") sources.set(r.roles!.id, [...(sources.get(r.roles!.id) ?? []), r.roles!.name]);
  for (const g of groups) {
    if (g.status !== "active") continue;
    for (const gr of g.roles) if (gr.status === "active") sources.set(gr.id, [...(sources.get(gr.id) ?? []), `${gr.displayName} (via ${g.name})`]);
  }
  const roleIds = [...sources.keys()];
  const people = await namesOf([...roles.map((r) => r.granted_by), m.invited_by].filter((x): x is string => !!x));
  const { data: grants, error: grantsError } = roleIds.length
    ? await db.from("role_permissions").select("role_id, permissions(key)").in("role_id", roleIds).returns<{ role_id: string; permissions: { key: string } | null }[]>()
    : { data: [], error: null };
  if (grantsError) throw new ApiError(500, "QUERY_FAILED", grantsError.message);
  return {
    userId,
    email: user?.email ?? "",
    displayName: user?.display_name ?? null,
    status: m.status,
    statusReason: m.status_reason,
    statusChangedAt: m.status_changed_at,
    accountType: m.account_type,
    authMethod: m.auth_method,
    invitedAt: m.invited_at,
    invitedBy: m.invited_by ? { userId: m.invited_by, name: people.get(m.invited_by) ?? "A former member" } : null,
    joinedAt: m.created_at,
    lastSignInAt: authUser?.user?.last_sign_in_at ?? null,
    roles: roles
      .map((r) => ({
        role: r.roles!.name,
        displayName: r.roles!.display_name,
        description: r.roles!.description,
        custom: r.roles!.tenant_id !== null,
        active: r.roles!.status === "active",
        grantedAt: r.created_at,
        grantedBy: r.granted_by ? { userId: r.granted_by, name: people.get(r.granted_by) ?? "A former member" } : null,
      }))
      .sort((a, b) => a.role.localeCompare(b.role)),
    // A suspended, deactivated or invited member holds no effective access.
    permissions:
      m.status === "active"
        ? effectivePermissions(
            (grants ?? []).filter((g) => g.permissions).flatMap((g) => (sources.get(g.role_id) ?? []).map((source) => ({ role: source, permission: g.permissions!.key }))),
          )
        : [],
    groups,
  };
}

async function namesOf(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await supabaseServiceRole().from("users").select("id, email, display_name").in("id", ids);
  for (const u of (data ?? []) as { id: string; email: string; display_name: string | null }[]) out.set(u.id, u.display_name || u.email);
  return out;
}

// ------------------------------------------------------------- invitations

export type InviteResult = { userId: string; status: MembershipStatus; emailSent: boolean; existingAccount: boolean };

/**
 * Invite someone, or add them now (spec §7–9). The account is created if
 * the address has none; the membership is `invited` (becomes active when
 * they accept) or `active`; the chosen roles are granted by the actor.
 * The set-password link is sent only to the invitee's own inbox — never
 * returned to the administrator, since it signs in as that person.
 */
export async function inviteUser(
  tenant: { tenantId: string; name: string; url: string | null },
  actor: { userId: string; email: string | null },
  input: InviteInput,
): Promise<{ ok: true; value: InviteResult; invite: ValidInvite } | { ok: false; errors: Record<string, string> }> {
  const assignable = (await listAssignableRoles(tenant.tenantId)).map((r) => r.name);
  const parsed = validateInvite(input, assignable);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (actor.email && v.email === actor.email.toLowerCase()) return { ok: false, errors: { email: "That's you — you are already a member." } };

  const db = supabaseServiceRole();
  const { data: found, error: findError } = await db
    .from("users")
    .select("id")
    .ilike("email", v.email.replace(/([%_\\])/g, "\\$1"))
    .maybeSingle<{ id: string }>();
  if (findError) throw new ApiError(500, "QUERY_FAILED", findError.message);

  let userId = found?.id ?? null;
  const existingAccount = !!userId;
  if (!userId) {
    const { data: created, error: createError } = await db.auth.admin.createUser({ email: v.email, email_confirm: true, user_metadata: { display_name: v.displayName } });
    if (createError || !created.user) throw new ApiError(500, "CREATE_FAILED", "The account could not be created. Nothing else was changed.");
    userId = created.user.id;
    // handle_new_user() created public.users; give it the name.
    await db.from("users").update({ display_name: v.displayName }).eq("id", userId);
  }

  const now = new Date().toISOString();
  const status: MembershipStatus = v.method === "invite" ? "invited" : "active";
  const existing = await membershipIn(tenant.tenantId, userId);
  if (existing && existing.status !== "removed") return { ok: false, errors: { email: `Already in this organization (${existing.status}).` } };
  const fields = {
    status,
    status_reason: null,
    status_changed_by: actor.userId,
    status_changed_at: now,
    invited_by: actor.userId,
    invited_at: now,
    account_type: v.accountType,
    auth_method: v.authMethod,
  };
  const { error: memberError } = existing
    ? await db.from("tenant_memberships").update(fields).eq("tenant_id", tenant.tenantId).eq("user_id", userId).eq("status", "removed")
    : await db.from("tenant_memberships").insert({ tenant_id: tenant.tenantId, user_id: userId, ...fields });
  if (memberError) {
    if (memberError.code === "23505") return { ok: false, errors: { email: "Already in this organization." } };
    throw new ApiError(500, "INVITE_FAILED", memberError.message);
  }

  if (v.roles.length) {
    const { data: roleRows } = await db.from("roles").select("id, name").is("tenant_id", null).in("name", v.roles);
    const rows = ((roleRows ?? []) as { id: string; name: string }[]).map((r) => ({ tenant_id: tenant.tenantId, user_id: userId, role_id: r.id, granted_by: actor.userId }));
    const { error: roleError } = await db.from("user_roles").upsert(rows, { onConflict: "tenant_id,user_id,role_id", ignoreDuplicates: true });
    if (roleError) throw new ApiError(500, "ASSIGN_FAILED", "The membership was created but its roles were not. Assign them on the user's page.");
  }

  const emailSent = await sendInvitationEmail(v, tenant, actor);
  await writeAudit({
    tenantId: tenant.tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: v.method === "invite" ? "user.invited" : "user.created",
    objectType: "user",
    objectId: userId,
    outcome: "success",
    // No e-mail address or name: identifiers only (#10, §17.7).
    metadata: { roles: v.roles, accountType: v.accountType, authMethod: v.authMethod, existingAccount, emailSent, previousStatus: existing?.status ?? null },
  });
  return { ok: true, value: { userId, status, emailSent, existingAccount }, invite: v };
}

/**
 * The invitation e-mail. Delivered only when e-mail is configured
 * (Resend, as for notifications); it links to a set-password page on the
 * organization's own address. Never throws: a delivery failure is reported
 * as "not sent", and the person can still use "Forgot password".
 */
async function sendInvitationEmail(v: ValidInvite, tenant: { name: string; url: string | null }, actor: { email: string | null }): Promise<boolean> {
  const apiKey = getResendApiKey();
  const from = getResendFromEmail();
  if (!apiKey || !from || !tenant.url) return false;
  try {
    const { data, error } = await supabaseServiceRole().auth.admin.generateLink({
      type: "recovery",
      email: v.email,
      options: { redirectTo: `${tenant.url}/auth/callback?next=/update-password` },
    });
    const link = data?.properties?.action_link;
    if (error || !link) return false;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: v.email,
        subject: `You have been invited to ${tenant.name} on WonderID`,
        text:
          `${actor.email ?? "An administrator"} invited you to ${tenant.name} on WonderID.\n\n` +
          `Set your password and sign in: ${link}\n\n` +
          `Your organization's address: ${tenant.url}\n\nWonderID\nIDENTITIES • AGENTS • ACCESS • SECURITY\n`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The signed-in person's own pending invitations (read by their own user id only). */
export async function listMyInvitations(userId: string): Promise<{ tenantId: string; tenantName: string; invitedAt: string | null }[]> {
  const { data, error } = await supabaseServiceRole()
    .from("tenant_memberships")
    .select("tenant_id, invited_at, tenants!inner(name, status)")
    .eq("user_id", userId)
    .eq("status", "invited")
    .eq("tenants.status", "active")
    .returns<{ tenant_id: string; invited_at: string | null; tenants: { name: string } }[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenants.name, invitedAt: r.invited_at }));
}

/** Accept your own invitation: invited → active. Only your own row, only from `invited`. */
export async function acceptInvitation(userId: string, tenantId: string): Promise<void> {
  const { data, error } = await supabaseServiceRole()
    .from("tenant_memberships")
    .update({ status: "active", status_changed_by: userId, status_reason: null })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "invited")
    .select("user_id");
  if (error) throw new ApiError(500, "ACCEPT_FAILED", error.message);
  if (!data?.length) throw new ApiError(404, "NO_INVITATION", "There is no pending invitation to this organization.");
  await writeAudit({ tenantId, actorId: userId, actorType: "user", action: "user.invitation_accepted", objectType: "user", objectId: userId, outcome: "success" });
}

// ------------------------------------------------------------- lifecycle

export type StatusChangeResult = { status: MembershipStatus; sessionsEnded: number | null };

/** Suspend, reactivate, deactivate or remove (spec §32). Refusals are audited too. */
export async function changeUserStatus(tenantId: string, actorId: string, userId: string, action: StatusAction, rawReason: unknown): Promise<StatusChangeResult> {
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 1000) : null;
  const m = UUID_RE.test(userId) ? await membershipIn(tenantId, userId) : null;
  if (!m || m.status === "removed") throw new ApiError(404, "NOT_FOUND", "No such user in this organization");
  const t = TRANSITIONS[action];
  const refusal = checkStatusChange(action, m.status, actorId, userId, reason);
  if (refusal) {
    await auditRefusal(tenantId, actorId, userId, t.auditAction, refusal.code);
    throw new ApiError(refusal.status, refusal.code, refusal.message);
  }

  const db = supabaseServiceRole();
  // Conditional on the status just read: a concurrent change wins cleanly.
  const { data, error } = await db
    .from("tenant_memberships")
    .update({ status: t.to, status_reason: reason, status_changed_by: actorId })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", m.status)
    .select("user_id");
  if (error) {
    const db409 = databaseRefusal(error);
    if (db409) {
      await auditRefusal(tenantId, actorId, userId, t.auditAction, db409.code);
      throw new ApiError(db409.status, db409.code, db409.message);
    }
    throw new ApiError(500, "UPDATE_FAILED", error.message);
  }
  if (!data?.length) throw new ApiError(409, "CHANGED", "This user changed while you were looking. Reload and try again.");

  if (action === "remove") {
    // A removed member keeps no roles (the history stays in the audit log).
    const { error: rolesError } = await db.from("user_roles").delete().eq("tenant_id", tenantId).eq("user_id", userId);
    if (rolesError) throw new ApiError(500, "REMOVE_FAILED", "The member was removed but their roles were not. Remove them on their user page.");
    // …nor any group (FOUNDATION-P0-26).
    const { error: groupsError } = await db.from("group_members").delete().eq("tenant_id", tenantId).eq("user_id", userId);
    if (groupsError) throw new ApiError(500, "REMOVE_FAILED", "The member was removed but is still in groups. Remove them from their groups.");
  }

  // Tenant access already ended with the status (only `active` reaches
  // tenant data). Ending sessions also signs them out everywhere, now.
  let sessionsEnded: number | null = null;
  if (t.endsSessions) sessionsEnded = await endSessions(userId);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: t.auditAction,
    objectType: "user",
    objectId: userId,
    outcome: "success",
    metadata: { from: m.status, to: t.to, reason, sessionsEnded },
  });
  return { status: t.to, sessionsEnded };
}

async function auditRefusal(tenantId: string, actorId: string, userId: string, action: string, code: string) {
  await writeAudit({ tenantId, actorId, actorType: "user", action, objectType: "user", objectId: userId, outcome: "failure", metadata: { refused: code } });
}

async function endSessions(userId: string): Promise<number | null> {
  const { data, error } = await supabaseServiceRole().rpc("revoke_user_sessions", { p_user: userId });
  return error ? null : Number(data ?? 0);
}

export type SessionInfo = { sessionId: string; createdAt: string; lastActiveAt: string; userAgent: string | null; aal: string | null };

/** A member's live sessions (browser and times; no IP address). */
export async function listUserSessions(tenantId: string, userId: string): Promise<SessionInfo[]> {
  const m = UUID_RE.test(userId) ? await membershipIn(tenantId, userId) : null;
  if (!m) throw new ApiError(404, "NOT_FOUND", "No such user in this organization");
  const { data, error } = await supabaseServiceRole().rpc("user_sessions", { p_user: userId });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as { session_id: string; created_at: string; last_active_at: string; user_agent: string | null; aal: string | null }[]).map((s) => ({
    sessionId: s.session_id,
    createdAt: s.created_at,
    lastActiveAt: s.last_active_at,
    userAgent: s.user_agent,
    aal: s.aal,
  }));
}

/** Revoke all of a member's sessions (spec §33). Not your own — sign out instead. */
export async function revokeUserSessions(tenantId: string, actorId: string, userId: string): Promise<number> {
  const m = UUID_RE.test(userId) ? await membershipIn(tenantId, userId) : null;
  if (!m || m.status === "removed") throw new ApiError(404, "NOT_FOUND", "No such user in this organization");
  if (actorId === userId) throw new ApiError(403, "SELF_SESSION_REVOKE", "To end your own sessions, sign out.");
  const n = await endSessions(userId);
  if (n === null) throw new ApiError(500, "REVOKE_FAILED", "The sessions could not be ended. Nothing was changed.");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "user.sessions_revoked",
    objectType: "user",
    objectId: userId,
    outcome: "success",
    metadata: { sessionsEnded: n },
  });
  return n;
}

/** Edit the name shown for a member (their account's display name). */
export async function updateUserName(tenantId: string, actorId: string, userId: string, rawName: unknown): Promise<void> {
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  if (!name) throw new ApiError(400, "VALIDATION", "Enter a name.");
  const m = UUID_RE.test(userId) ? await membershipIn(tenantId, userId) : null;
  if (!m || m.status === "removed") throw new ApiError(404, "NOT_FOUND", "No such user in this organization");
  const { error } = await supabaseServiceRole().from("users").update({ display_name: name }).eq("id", userId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "user.updated",
    objectType: "user",
    objectId: userId,
    outcome: "success",
    metadata: { changed: ["displayName"] },
  });
}

// ------------------------------------------------------------ history

export type AccessEvent = { id: string; at: string; action: string; outcome: string; actor: string; detail: Record<string, unknown> };

/**
 * A member's access history (spec §34): lifecycle and role changes made
 * to them, and refusals, newest first. Read from this organization's
 * audit log only.
 */
export async function getAccessHistory(tenantId: string, userId: string, limit = 50): Promise<AccessEvent[]> {
  if (!UUID_RE.test(userId)) return [];
  const { data, error } = await supabaseServiceRole()
    .from("audit_logs")
    .select("id, created_at, action, outcome, actor_id, metadata")
    .eq("tenant_id", tenantId)
    .eq("object_id", userId)
    .in("object_type", ["user", "user_role"])
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const rows = (data ?? []) as { id: string; created_at: string; action: string; outcome: string; actor_id: string | null; metadata: Record<string, unknown> | null }[];
  const names = await namesOf(rows.map((r) => r.actor_id).filter((x): x is string => !!x));
  return rows.map((r) => ({
    id: r.id,
    at: r.created_at,
    action: r.action,
    outcome: r.outcome,
    actor: r.actor_id ? (names.get(r.actor_id) ?? "A former member") : "System",
    detail: r.metadata ?? {},
  }));
}

export { checkRoleGrant, databaseRefusal };
