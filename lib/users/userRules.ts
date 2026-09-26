/**
 * FOUNDATION-P0-23 — the pure rules of the user lifecycle (spec §5–8,
 * 30–32): which status change each action makes and from where, what an
 * invitation must carry, and the self-protection rules. No I/O; the
 * database enforces the same self-protection and last-administrator rules
 * again (migration 0096), so a bug here can never be the only guard.
 */

export const MEMBERSHIP_STATUSES = ["invited", "active", "suspended", "deactivated", "removed"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ACCOUNT_TYPES = ["internal", "external"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const AUTH_METHODS = ["tenant_default", "password", "sso"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export const INVITE_METHODS = ["invite", "add"] as const;
export type InviteMethod = (typeof INVITE_METHODS)[number];

export const STATUS_ACTIONS = ["suspend", "reactivate", "deactivate", "remove"] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

export const STATUS_LABEL: Record<MembershipStatus, string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
  removed: "Removed",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { internal: "Internal user", external: "External / contractor" };
export const AUTH_METHOD_LABEL: Record<AuthMethod, string> = { tenant_default: "Organization default", password: "Email and password", sso: "Single sign-on only" };

type Transition = { from: readonly MembershipStatus[]; to: MembershipStatus; permission: string; reasonRequired: boolean; endsSessions: boolean; auditAction: string };

export const TRANSITIONS: Record<StatusAction, Transition> = {
  suspend: { from: ["active", "invited"], to: "suspended", permission: "users.suspend", reasonRequired: true, endsSessions: true, auditAction: "user.suspended" },
  reactivate: { from: ["suspended", "deactivated"], to: "active", permission: "users.suspend", reasonRequired: false, endsSessions: false, auditAction: "user.reactivated" },
  deactivate: {
    from: ["active", "invited", "suspended"],
    to: "deactivated",
    permission: "users.suspend",
    reasonRequired: true,
    endsSessions: true,
    auditAction: "user.deactivated",
  },
  remove: {
    from: ["active", "invited", "suspended", "deactivated"],
    to: "removed",
    permission: "users.remove",
    reasonRequired: true,
    endsSessions: true,
    auditAction: "user.removed",
  },
};

export type Refusal = { code: string; message: string; status: number };

/** Whether `actorId` may apply `action` to `targetId`, now at `current`. Null when allowed. */
export function checkStatusChange(action: StatusAction, current: MembershipStatus, actorId: string, targetId: string, reason: string | null): Refusal | null {
  const t = TRANSITIONS[action];
  if (actorId === targetId) {
    return { code: "SELF_STATUS_CHANGE", status: 403, message: "You can't change your own membership. Ask another administrator." };
  }
  if (!t.from.includes(current)) {
    return {
      code: "INVALID_TRANSITION",
      status: 409,
      message: `A ${STATUS_LABEL[current].toLowerCase()} user can't be ${t.to === "active" ? "reactivated" : STATUS_LABEL[t.to].toLowerCase()}.`,
    };
  }
  if (t.reasonRequired && !reason) {
    return { code: "REASON_REQUIRED", status: 400, message: "Give a reason. It is kept in the audit log." };
  }
  return null;
}

/** Nobody grants themselves a role (spec §30). Removing one of your own roles is not escalation. */
export function checkRoleGrant(actorId: string, targetId: string): Refusal | null {
  return actorId === targetId ? { code: "SELF_ESCALATION", status: 403, message: "You can't assign a role to yourself. Another administrator must do it." } : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteInput = {
  email?: unknown;
  displayName?: unknown;
  jobTitle?: unknown;
  department?: unknown;
  accountType?: unknown;
  authMethod?: unknown;
  method?: unknown;
  roles?: unknown;
};

export type ValidInvite = {
  email: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  accountType: AccountType;
  authMethod: AuthMethod;
  method: InviteMethod;
  roles: string[];
};

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

export function validateInvite(input: InviteInput, assignableRoles: readonly string[]): { ok: true; value: ValidInvite } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  const displayName = text(input.displayName, 120);
  if (!displayName) errors.displayName = "Enter the person's full name.";
  const accountType = (ACCOUNT_TYPES as readonly string[]).includes(input.accountType as string) ? (input.accountType as AccountType) : null;
  if (!accountType) errors.accountType = "Choose an account type.";
  const authMethod = (AUTH_METHODS as readonly string[]).includes(input.authMethod as string) ? (input.authMethod as AuthMethod) : null;
  if (!authMethod) errors.authMethod = "Choose how they sign in.";
  const method = (INVITE_METHODS as readonly string[]).includes(input.method as string) ? (input.method as InviteMethod) : null;
  if (!method) errors.method = "Choose whether to invite or add them.";
  const rawRoles = Array.isArray(input.roles) ? input.roles : [];
  const roles = [...new Set(rawRoles.filter((r): r is string => typeof r === "string"))];
  const unknown = roles.filter((r) => !assignableRoles.includes(r));
  if (unknown.length) errors.roles = `Unknown role: ${unknown.join(", ")}`;
  if (roles.length > 20) errors.roles = "Too many roles.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      email,
      displayName: displayName!,
      jobTitle: text(input.jobTitle, 200),
      department: text(input.department, 200),
      accountType: accountType!,
      authMethod: authMethod!,
      method: method!,
      roles,
    },
  };
}

/** The permission an invitation needs: inviting sends an invitation; adding makes them a member now. */
export function invitePermission(method: InviteMethod): string {
  return method === "invite" ? "users.invite" : "users.create";
}

/**
 * Effective permissions with their provenance (spec §25): each permission
 * the user holds, and every role that grants it.
 */
export function effectivePermissions(grants: { role: string; permission: string }[]): { permission: string; roles: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const g of grants) {
    if (!by.has(g.permission)) by.set(g.permission, new Set());
    by.get(g.permission)!.add(g.role);
  }
  return [...by.entries()].map(([permission, roles]) => ({ permission, roles: [...roles].sort() })).sort((a, b) => a.permission.localeCompare(b.permission));
}

/** A database refusal from migration 0096's guards, as the caller should see it. */
export function databaseRefusal(error: { code?: string; message?: string } | null): Refusal | null {
  const msg = error?.message ?? "";
  if (msg.includes("LAST_TENANT_ADMIN")) {
    return { code: "LAST_TENANT_ADMIN", status: 409, message: "This would leave the organization without a Tenant Administrator. Assign another administrator first." };
  }
  if (msg.includes("SELF_STATUS_CHANGE")) return { code: "SELF_STATUS_CHANGE", status: 403, message: "You can't change your own membership." };
  if (msg.includes("user_roles_no_self_grant")) return { code: "SELF_ESCALATION", status: 403, message: "You can't assign a role to yourself." };
  return null;
}

/** How a system role is named on screen (Phase 4b decision 2); the key stays the stable id. */
const ROLE_NAMES: Record<string, string> = {
  TENANT_SUPER_ADMIN: "Tenant Administrator",
  IAM_ADMIN: "Identity Administrator",
  SECURITY_ADMIN: "Security Administrator",
  IAM_ARCHITECT: "IAM Architect",
};

export function roleLabel(role: string): string {
  return (
    ROLE_NAMES[role] ??
    role
      .toLowerCase()
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(" ")
  );
}
