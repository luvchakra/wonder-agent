/**
 * Shared contracts owned by the Foundation Agent (docs/plan/01-FOUNDATION-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining tenant/user/RBAC/audit shapes.
 */

export type TenantContext = {
  userId: string;
  tenantId: string | null;
  tenantSlug: string | null;
  roles: string[];
  permissions: string[];
};

export type Role = {
  id: string;
  tenantId: string | null; // null = system role template
  name: string;
  description: string | null;
  isSystem: boolean;
};

export type Permission = {
  id: string;
  key: string;
  description: string;
};

export type AuditActorType = "user" | "system" | "integration";
export type AuditOutcome = "success" | "failure";

export type AuditEvent = {
  tenantId: string;
  actorId?: string | null;
  actorType: AuditActorType;
  action: string;
  objectType: string;
  objectId: string;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
  correlationId?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
