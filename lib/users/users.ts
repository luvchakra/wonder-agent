import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getResendApiKey, getResendFromEmail } from "@/lib/db/env";
import { writeAudit } from "@/lib/audit/writeAudit";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { ApiError } from "@/lib/shared/types/foundation";
import { groupsOfUser, type UserGroup } from "./groups";
import { describeTerms, isTenantWide, termsCurrent, type AssignmentTerms } from "@/lib/rbac/assignmentRules";
import { getTenantConfig } from "@/lib/config/tenantConfig";
import { urlForTenant } from "@/lib/tenant/hostTenant";
import type { ImportApplyRow, ImportPlanRow } from "@/lib/shared/types/integrations";
import {
  TRANSITIONS,
  checkRoleGrant,
  checkStatusChange,
  classifyMemberRow,
  databaseRefusal,
  effectivePermissions,
  invitationEscalation,
  invitationExpired,
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
  /** FOUNDATION-P0-34: the membership's number in this organization, the key of the user page. */
  memberRef: number | null;
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
  // FOUNDATION-P0-34: the page's membership numbers, for the user-page links (this tenant only, §14).
  const refOf = new Map<string, number>();
  if (rows.length) {
    const { data: refs, error: refError } = await supabaseServiceRole()
      .from("tenant_memberships")
      .select("user_id, ref")
      .eq("tenant_id", tenantId)
      .in(
        "user_id",
        rows.map((r) => r.user_id),
      );
    if (refError) throw new ApiError(500, "QUERY_FAILED", refError.message);
    for (const m of (refs ?? []) as { user_id: string; ref: number }[]) refOf.set(m.user_id, Number(m.ref));
  }
  return {
    total: rows[0] ? Number(rows[0].total) : 0,
    items: rows.map((r) => ({
      userId: r.user_id,
      memberRef: refOf.get(r.user_id) ?? null,
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
  ref: number | null;
};

async function membershipIn(tenantId: string, userId: string): Promise<MembershipRow | null> {
  const { data, error } = await supabaseServiceRole()
    .from("tenant_memberships")
    .select("user_id, status, status_reason, status_changed_at, status_changed_by, invited_by, invited_at, account_type, auth_method, created_at, ref")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRow>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data;
}

/**
 * Owner feedback 2026-10-14 — the member a person's identity stands for in
 * this organization, so their identity page can show and change their ID
 * roles: the identity's own user, or else the account with the same email.
 * Only a membership in *this* tenant counts (filtered by tenant_id, §14), and
 * never a removed one. Returns the member's user id, or null.
 */
export async function findMemberForPerson(tenantId: string, person: { userId: string | null; email: string | null }): Promise<string | null> {
  let userId = person.userId && UUID.test(person.userId) ? person.userId : null;
  const email = person.email?.trim();
  if (!userId && email) {
    const { data, error } = await supabaseServiceRole()
      .from("users")
      .select("id")
      .ilike("email", email.replace(/([%_\\])/g, "\\$1"))
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    userId = data?.id ?? null;
  }
  if (!userId) return null;
  const m = await membershipIn(tenantId, userId);
  return m && m.status !== "removed" ? userId : null;
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
  /** Scope, validity and condition (FOUNDATION-P0-19). */
  terms: AssignmentTerms;
};

export type UserDetail = {
  userId: string;
  /** FOUNDATION-P0-34: the membership's number, the key of the user page. */
  memberRef: number | null;
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
  scope_type: AssignmentTerms["scopeType"];
  scope_values: string[];
  starts_at: string | null;
  expires_at: string | null;
  requires_mfa: boolean;
  roles: { id: string; name: string; display_name: string; description: string | null; status: string; tenant_id: string | null } | null;
};

const termsOf = (r: RoleAssignmentRow): AssignmentTerms => ({
  scopeType: r.scope_type ?? "tenant",
  scopeValues: r.scope_values ?? [],
  startsAt: r.starts_at,
  expiresAt: r.expires_at,
  requiresMfa: !!r.requires_mfa,
});

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
      .select("created_at, granted_by, scope_type, scope_values, starts_at, expires_at, requires_mfa, roles(id, name, display_name, description, status, tenant_id)")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .returns<RoleAssignmentRow[]>(),
    groupsOfUser(tenantId, userId),
  ]);
  if (rolesError) throw new ApiError(500, "QUERY_FAILED", rolesError.message);
  const roles = (roleRows ?? []).filter((r) => r.roles);
  // What grants what: active direct roles by name; active roles of active groups as "Role (via Group)".
  // FOUNDATION-P0-19 — only assignments in effect now count, and a scoped or
  // conditional one says where and when, e.g. "Agent Administrator (Environment: production · MFA)".
  const now = new Date();
  const sources = new Map<string, string[]>();
  const add = (roleId: string, label: string) => sources.set(roleId, [...(sources.get(roleId) ?? []), label]);
  for (const r of roles) {
    const t = termsOf(r);
    if (r.roles!.status !== "active" || !termsCurrent(t, now)) continue;
    add(r.roles!.id, isTenantWide(t) ? r.roles!.name : `${r.roles!.display_name} (${describeTerms(t)})`);
  }
  for (const g of groups) {
    if (g.status !== "active") continue;
    for (const gr of g.roles) {
      if (gr.status !== "active" || !termsCurrent(gr.terms, now)) continue;
      add(gr.id, isTenantWide(gr.terms) ? `${gr.displayName} (via ${g.name})` : `${gr.displayName} (via ${g.name}; ${describeTerms(gr.terms)})`);
    }
  }
  const roleIds = [...sources.keys()];
  const people = await namesOf([...roles.map((r) => r.granted_by), m.invited_by].filter((x): x is string => !!x));
  const { data: grants, error: grantsError } = roleIds.length
    ? await db.from("role_permissions").select("role_id, permissions(key)").in("role_id", roleIds).returns<{ role_id: string; permissions: { key: string } | null }[]>()
    : { data: [], error: null };
  if (grantsError) throw new ApiError(500, "QUERY_FAILED", grantsError.message);
  return {
    userId,
    memberRef: m.ref ?? null,
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
        terms: termsOf(r),
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
  actor: { userId: string; email: string | null; permissions: readonly string[] },
  input: InviteInput,
  via?: Record<string, unknown>,
): Promise<{ ok: true; value: InviteResult; invite: ValidInvite } | { ok: false; errors: Record<string, string> }> {
  const assignable = (await listAssignableRoles(tenant.tenantId)).map((r) => r.name);
  const parsed = validateInvite(input, assignable);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (actor.email && v.email === actor.email.toLowerCase()) return { ok: false, errors: { email: "That's you — you are already a member." } };
  // FOUNDATION-P0-32: inviting never escalates: the roles given carry only permissions the inviter holds.
  const roleRows = await rolesWithPermissions(tenant.tenantId, v.roles);
  const escalated = invitationEscalation(roleRows.flatMap((r) => r.permissions), actor.permissions);
  if (escalated.length) {
    await writeAudit({ tenantId: tenant.tenantId, actorId: actor.userId, actorType: "user", action: "user.invited", objectType: "tenant", objectId: tenant.tenantId, outcome: "failure", metadata: { roles: v.roles, refused: "ROLE_ESCALATION", permissions: escalated } });
    return { ok: false, errors: { roles: `You can only give roles whose permissions you hold. Not held: ${escalated.join(", ")}` } };
  }

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
    // System roles and the organization's own custom roles (FOUNDATION-P0-32: custom roles were skipped before).
    const rows = roleRows.map((r) => ({ tenant_id: tenant.tenantId, user_id: userId, role_id: r.id, granted_by: actor.userId }));
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
    metadata: { roles: v.roles, accountType: v.accountType, authMethod: v.authMethod, existingAccount, emailSent, previousStatus: existing?.status ?? null, ...(via ?? {}) },
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

/**
 * The signed-in person's own pending invitations (read by their own user id only).
 * FOUNDATION-P0-32: one past its organization's limit is marked expired.
 */
export async function listMyInvitations(userId: string): Promise<{ tenantId: string; tenantName: string; invitedAt: string | null; expired: boolean }[]> {
  const { data, error } = await supabaseServiceRole()
    .from("tenant_memberships")
    .select("tenant_id, invited_at, tenants!inner(name, status)")
    .eq("user_id", userId)
    .eq("status", "invited")
    .eq("tenants.status", "active")
    .returns<{ tenant_id: string; invited_at: string | null; tenants: { name: string } }[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const days = await Promise.all((data ?? []).map((r) => getTenantConfig(r.tenant_id).then((c) => c["users.invitationExpiryDays"])));
  return (data ?? []).map((r, i) => ({ tenantId: r.tenant_id, tenantName: r.tenants.name, invitedAt: r.invited_at, expired: invitationExpired(r.invited_at, days[i]) }));
}

/** Accept your own invitation: invited → active. Only your own row, only from `invited`, only before it expires. */
export async function acceptInvitation(userId: string, tenantId: string): Promise<void> {
  const db = supabaseServiceRole();
  const { data: pending, error: readError } = await db.from("tenant_memberships").select("invited_at").eq("tenant_id", tenantId).eq("user_id", userId).eq("status", "invited").maybeSingle();
  if (readError) throw new ApiError(500, "QUERY_FAILED", readError.message);
  if (!pending) throw new ApiError(404, "NO_INVITATION", "There is no pending invitation to this organization.");
  const expiryDays = (await getTenantConfig(tenantId))["users.invitationExpiryDays"];
  if (invitationExpired(pending.invited_at as string | null, expiryDays)) {
    await writeAudit({ tenantId, actorId: userId, actorType: "user", action: "user.invitation_accepted", objectType: "user", objectId: userId, outcome: "failure", metadata: { refused: "INVITATION_EXPIRED" } });
    throw new ApiError(410, "INVITATION_EXPIRED", "This invitation has expired. Ask an administrator to send it again.");
  }
  const { data, error } = await db
    .from("tenant_memberships")
    .update({ status: "active", status_changed_by: userId, status_reason: null })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "invited")
    // The invitation accepted is the one just checked: a re-send in between starts a new one.
    .eq("invited_at", pending.invited_at as string)
    .select("user_id");
  if (error) throw new ApiError(500, "ACCEPT_FAILED", error.message);
  if (!data?.length) throw new ApiError(404, "NO_INVITATION", "There is no pending invitation to this organization.");
  await writeAudit({ tenantId, actorId: userId, actorType: "user", action: "user.invitation_accepted", objectType: "user", objectId: userId, outcome: "success" });
}

/**
 * FOUNDATION-P0-32: send a pending invitation again. It starts a new
 * validity period and a new e-mail; the old link still works only as a
 * set-password link (it never adds anyone). Audited.
 */
export async function resendInvitation(tenant: { tenantId: string; name: string; url: string | null }, actor: { userId: string; email: string | null }, userId: string): Promise<{ emailSent: boolean }> {
  const db = supabaseServiceRole();
  const { data: person, error: personError } = await db.from("users").select("email, display_name").eq("id", userId).maybeSingle<{ email: string; display_name: string | null }>();
  if (personError) throw new ApiError(500, "QUERY_FAILED", personError.message);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("tenant_memberships")
    .update({ invited_at: now, invited_by: actor.userId })
    .eq("tenant_id", tenant.tenantId)
    .eq("user_id", userId)
    .eq("status", "invited")
    .select("user_id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data?.length || !person) throw new ApiError(409, "NOT_INVITED", "Only a pending invitation can be sent again.");
  const emailSent = await sendInvitationEmail({ email: person.email } as ValidInvite, tenant, actor);
  await writeAudit({ tenantId: tenant.tenantId, actorId: actor.userId, actorType: "user", action: "user.invitation_resent", objectType: "user", objectId: userId, outcome: "success", metadata: { emailSent } });
  return { emailSent };
}

/** System roles and the organization's own custom roles by name, with their permissions. */
export async function rolesWithPermissions(tenantId: string, names: string[]): Promise<{ id: string; name: string; permissions: string[] }[]> {
  if (!names.length) return [];
  const { data, error } = await supabaseServiceRole()
    .from("roles")
    .select("id, name, tenant_id, role_permissions(permissions(key))")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq("status", "active")
    .in("name", names)
    .returns<{ id: string; name: string; tenant_id: string | null; role_permissions: { permissions: { key: string } | null }[] }[]>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? [])
    .filter((r) => r.tenant_id === null || r.tenant_id === tenantId)
    .map((r) => ({ id: r.id, name: r.name, permissions: r.role_permissions.map((rp) => rp.permissions?.key).filter((k): k is string => Boolean(k)) }));
}

// ------------------------------------------------------------- bulk invitation (FOUNDATION-P0-32)

export type MemberRecord = { row: number | null; externalId: string; values: Record<string, unknown> };
export type BulkActor = { userId: string; email: string | null; permissions: readonly string[] };

/** What a bulk invitation would do, row by row: new, already a member (left as is), or invalid with the reason. */
export async function planMemberInvitations(tenantId: string, actor: BulkActor, records: MemberRecord[]): Promise<ImportPlanRow[]> {
  return (await classifyMembers(tenantId, actor, records)).map(({ record, decision }) => ({
    row: record.row,
    externalId: record.externalId,
    decision: decision.decision,
    targetId: null,
    changes: [],
    note: decision.note,
  }));
}

/**
 * Sends the new rows' invitations (one by one, each audited by inviteUser);
 * the rest are reported as they are. Sending the same file again sends
 * nothing twice: everyone it invited is already a member.
 */
export async function applyMemberInvitations(tenantId: string, actor: BulkActor, records: MemberRecord[]): Promise<ImportApplyRow[]> {
  const db = supabaseServiceRole();
  const { data: tenantRow } = await db.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle<{ name: string; slug: string | null }>();
  const tenant = { tenantId, name: tenantRow?.name ?? "your organization", url: tenantRow?.slug ? await urlForTenant(tenantRow.slug) : null };
  const out: ImportApplyRow[] = [];
  for (const { record, decision } of await classifyMembers(tenantId, actor, records)) {
    if (decision.decision !== "new" || !decision.invite) {
      out.push({ row: record.row, externalId: record.externalId, outcome: decision.decision === "unchanged" ? "unchanged" : "skipped", targetId: null, message: decision.note });
      continue;
    }
    try {
      const result = await inviteUser(tenant, actor, decision.invite);
      out.push(
        result.ok
          ? { row: record.row, externalId: record.externalId, outcome: "created", targetId: result.value.userId, message: result.value.emailSent ? null : "invited; the e-mail was not sent" }
          : { row: record.row, externalId: record.externalId, outcome: "skipped", targetId: null, message: Object.values(result.errors).join("; ") },
      );
    } catch (err) {
      out.push({ row: record.row, externalId: record.externalId, outcome: "failed", targetId: null, message: err instanceof ApiError ? err.message : "The invitation could not be sent" });
    }
  }
  return out;
}

async function classifyMembers(tenantId: string, actor: BulkActor, records: MemberRecord[]) {
  const db = supabaseServiceRole();
  const emails = [...new Set(records.map((r) => (typeof r.values.email === "string" ? r.values.email.trim().toLowerCase() : "")).filter(Boolean))];
  const assignable = (await listAssignableRoles(tenantId)).map((r) => r.name);
  const memberStatus = new Map<string, MembershipStatus>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data: people, error } = await db.from("users").select("id, email").in("email", emails.slice(i, i + 200));
    if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
    const byId = new Map((people ?? []).map((p) => [p.id as string, (p.email as string).toLowerCase()]));
    if (!byId.size) continue;
    const { data: members, error: memberError } = await db.from("tenant_memberships").select("user_id, status").eq("tenant_id", tenantId).in("user_id", [...byId.keys()]);
    if (memberError) throw new ApiError(500, "QUERY_FAILED", memberError.message);
    for (const m of members ?? []) memberStatus.set(byId.get(m.user_id as string)!, m.status as MembershipStatus);
  }
  const allRoles = [...new Set(records.flatMap((r) => (Array.isArray(r.values.roles) ? r.values.roles.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : [])))].filter((n) => assignable.includes(n));
  const permsOf = new Map((await rolesWithPermissions(tenantId, allRoles)).map((r) => [r.name, r.permissions]));
  const canAssignRoles = actor.permissions.some((p) => p === "roles.assign" || p === "role.manage");
  const seen = new Set<string>();
  return records.map((record) => {
    const email = typeof record.values.email === "string" ? record.values.email.trim().toLowerCase() : "";
    // The same e-mail twice in one file: the first row counts.
    if (email && seen.has(email)) return { record, decision: { decision: "invalid" as const, note: "The same e-mail appears earlier in the file", invite: null } };
    if (email) seen.add(email);
    const decision = classifyMemberRow(record.values, {
      assignableRoles: assignable,
      memberStatus,
      actorEmail: actor.email,
      canAssignRoles,
      escalation: (roles) => invitationEscalation(roles.flatMap((r) => permsOf.get(r) ?? []), actor.permissions),
    });
    return { record, decision };
  });
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
    // WID-H07: the reason stays on the membership (status_reason); the audit keeps its fingerprint.
    metadata: { from: m.status, to: t.to, sessionsEnded },
    typedText: { reason },
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

// ------------------------------------------------------------- joiners from an identity source (owner decision 2026-10-14)

/**
 * The permissions a member holds now through their tenant-wide, current
 * role assignments (direct or delegated); null when they are not an active
 * member. Used to re-check, on each run, that whoever set an identity
 * source's default ID role may still grant it.
 */
export async function memberHeldPermissions(tenantId: string, userId: string): Promise<string[] | null> {
  const db = supabaseServiceRole();
  const { data: m } = await db.from("tenant_memberships").select("tenant_id, status").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!m || m.tenant_id !== tenantId || m.status !== "active") return null;
  const now = Date.now();
  const { data, error } = await db.from("user_roles").select("tenant_id, starts_at, expires_at, roles(name)").eq("tenant_id", tenantId).eq("user_id", userId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const names = ((data ?? []) as unknown as { tenant_id: string; starts_at: string | null; expires_at: string | null; roles: { name: string } | null }[])
    .filter((r) => r.tenant_id === tenantId && (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.expires_at || Date.parse(r.expires_at) > now))
    .map((r) => r.roles?.name)
    .filter((n): n is string => Boolean(n));
  return [...new Set((await rolesWithPermissions(tenantId, [...new Set(names)])).flatMap((r) => r.permissions))];
}

/**
 * Invites a person an identity source has just created, with the source's
 * default ID role, on the authority of whoever set that role (checked again
 * now: still an active member holding every permission the role carries).
 * Someone already in the organization is left as they are.
 */
export async function inviteFromIdentitySource(
  tenantId: string,
  source: { id: string; defaultIdRole: string; defaultIdRoleSetBy: string },
  person: { email: string; displayName: string; jobTitle?: string | null; department?: string | null },
): Promise<{ outcome: "invited" | "already_member" | "refused"; message?: string }> {
  const holds = await memberHeldPermissions(tenantId, source.defaultIdRoleSetBy);
  if (!holds) return { outcome: "refused", message: "whoever set the default ID role is no longer an active member; set it again" };
  const db = supabaseServiceRole();
  const [{ data: setter }, { data: tenantRow }] = await Promise.all([
    db.from("users").select("email").eq("id", source.defaultIdRoleSetBy).maybeSingle<{ email: string | null }>(),
    db.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle<{ name: string; slug: string | null }>(),
  ]);
  const tenant = { tenantId, name: tenantRow?.name ?? "your organization", url: tenantRow?.slug ? await urlForTenant(tenantRow.slug) : null };
  const result = await inviteUser(
    tenant,
    { userId: source.defaultIdRoleSetBy, email: setter?.email ?? null, permissions: holds },
    { email: person.email, displayName: person.displayName, jobTitle: person.jobTitle ?? undefined, department: person.department ?? undefined, accountType: "internal", authMethod: "tenant_default", method: "invite", roles: [source.defaultIdRole] },
    { via: "identity_source", sourceId: source.id },
  );
  if (result.ok) return { outcome: "invited" };
  if (result.errors.email?.startsWith("Already in this organization") || result.errors.email?.startsWith("That's you")) return { outcome: "already_member" };
  return { outcome: "refused", message: Object.values(result.errors).join("; ") };
}
