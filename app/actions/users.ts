"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/requirePermission";
import { assignRole } from "@/lib/rbac/roles";
import { termsFromForm } from "@/lib/rbac/assignmentForm";
import { TENANT_COOKIE_NAME, getMyMemberships } from "@/lib/tenant/getTenantContext";
import { getSessionUser } from "@/lib/tenant/session";
import { urlForTenant } from "@/lib/tenant/hostTenant";
import { ApiError } from "@/lib/shared/types/foundation";
import { acceptInvitation, changeUserStatus, inviteUser, revokeUserSessions, updateUserName } from "@/lib/users/users";
import { STATUS_ACTIONS, invitePermission, type InviteMethod, type StatusAction } from "@/lib/users/userRules";
import { getIdentityForUser, updateIdentity } from "@/modules/agent-identity/service";

/**
 * FOUNDATION-P0-23 — the Users screens' server actions. Each resolves the
 * tenant and actor server-side and checks the permission for exactly what
 * it does; the service (lib/users) re-checks membership in this tenant,
 * the self-protection rules and the lifecycle, and the database enforces
 * both again. Refusals come back as messages (a thrown server-action error
 * is redacted in production).
 */

export type ActionState = { ok: boolean; message: string | null; errors?: Record<string, string> };

function refused(err: unknown): ActionState {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  throw err;
}

export async function inviteUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const method = (formData.get("method") === "add" ? "add" : "invite") as InviteMethod;
  const roles = formData.getAll("roles").map(String);
  let ctx;
  try {
    ctx = await requirePermission(invitePermission(method));
    // Granting roles on the way in is role management.
    if (roles.length && !ctx.permissions.some((p) => p === "roles.assign" || p === "role.manage")) {
      return { ok: false, message: "You can add people, but assigning roles needs role management. Leave the roles empty, or ask an administrator." };
    }
  } catch (err) {
    return refused(err);
  }
  const [memberships, user] = await Promise.all([getMyMemberships(), getSessionUser()]);
  const tenant = memberships.find((m) => m.tenantId === ctx.tenantId);
  const url = ctx.tenantSlug ? await urlForTenant(ctx.tenantSlug) : null;

  let result;
  try {
    result = await inviteUser(
      { tenantId: ctx.tenantId!, name: tenant?.name ?? "your organization", url },
      { userId: ctx.userId, email: user?.email ?? null },
      {
        email: formData.get("email"),
        displayName: formData.get("displayName"),
        jobTitle: formData.get("jobTitle"),
        department: formData.get("department"),
        accountType: formData.get("accountType"),
        authMethod: formData.get("authMethod"),
        method,
        roles,
      },
    );
  } catch (err) {
    return refused(err);
  }
  if (!result.ok) return { ok: false, message: "Check the highlighted fields.", errors: result.errors };

  // Job title, department and account type belong to the person's identity
  // (Identity Agent's published contract), written as the administrator —
  // so only when they may edit identities; otherwise said, not dropped silently.
  const v = result.invite;
  let profile = "saved";
  if (v.jobTitle || v.department || v.accountType === "external") {
    if (!ctx.permissions.includes("identity.manage")) {
      profile = "skipped";
    } else {
      try {
        const identity = await getIdentityForUser(ctx.tenantId!, result.value.userId);
        if (identity) {
          await updateIdentity(ctx.tenantId!, ctx.userId, identity.id, {
            ...(v.jobTitle ? { title: v.jobTitle } : {}),
            ...(v.department ? { department: v.department } : {}),
            ...(v.accountType === "external" ? { subtype: "contractor" } : {}),
          });
        } else profile = "skipped";
      } catch {
        profile = "failed";
      }
    }
  }
  revalidatePath("/settings/users");
  const q = new URLSearchParams({ created: result.value.status, email: result.value.emailSent ? "sent" : "not-sent", profile });
  redirect(`/settings/users/${result.value.userId}?${q.toString()}`);
}

export async function changeUserStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const action = String(formData.get("action") ?? "") as StatusAction;
  if (!(STATUS_ACTIONS as readonly string[]).includes(action)) return { ok: false, message: "Unknown action." };
  const userId = String(formData.get("userId") ?? "");
  try {
    const ctx = await requirePermission(action === "remove" ? "users.remove" : "users.suspend");
    const r = await changeUserStatus(ctx.tenantId!, ctx.userId, userId, action, formData.get("reason"));
    revalidatePath("/settings/users");
    revalidatePath(`/settings/users/${userId}`);
    const ended = r.sessionsEnded === null ? "" : r.sessionsEnded > 0 ? ` ${r.sessionsEnded} session${r.sessionsEnded === 1 ? "" : "s"} ended.` : " They had no active sessions.";
    const done = { suspend: "Suspended.", reactivate: "Reactivated.", deactivate: "Deactivated.", remove: "Removed from the organization." }[action];
    return { ok: true, message: `${done}${ended}` };
  } catch (err) {
    return refused(err);
  }
}

export async function revokeSessionsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = String(formData.get("userId") ?? "");
  try {
    const ctx = await requirePermission("users.suspend");
    const n = await revokeUserSessions(ctx.tenantId!, ctx.userId, userId);
    revalidatePath(`/settings/users/${userId}`);
    return { ok: true, message: n ? `${n} session${n === 1 ? "" : "s"} ended. They must sign in again.` : "They had no active sessions." };
  } catch (err) {
    return refused(err);
  }
}

export async function updateUserNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = String(formData.get("userId") ?? "");
  try {
    const ctx = await requirePermission("users.update");
    await updateUserName(ctx.tenantId!, ctx.userId, userId, formData.get("displayName"));
    revalidatePath(`/settings/users/${userId}`);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return refused(err);
  }
}

export async function assignUserRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!role) return { ok: false, message: "Choose a role." };
  const terms = termsFromForm(formData, role);
  if (!terms.ok) return { ok: false, message: "Check the assignment's scope and dates.", errors: terms.errors };
  try {
    const ctx = await requireAnyPermission(["roles.assign", "role.manage"]);
    await assignRole(ctx.tenantId!, ctx.userId, userId, role, terms.terms);
    revalidatePath(`/settings/users/${userId}`);
    revalidatePath("/settings/users");
    return { ok: true, message: `${role} assigned.` };
  } catch (err) {
    return refused(err);
  }
}

/** The invitee accepts their own invitation, and lands in that organization. */
export async function acceptInvitationAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const tenantId = String(formData.get("tenantId") ?? "");
  await acceptInvitation(user.id, tenantId);
  (await cookies()).set(TENANT_COOKIE_NAME, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}
