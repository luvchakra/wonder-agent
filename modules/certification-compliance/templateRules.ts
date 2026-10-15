/**
 * COMPLIANCE-P0-14 part 1 — campaign templates, pure (#9). A template is a
 * saved launch: the scope, who reviews, the cadence and how many days
 * reviewers get. Only known fields are kept; nothing typed reaches a query.
 */

const SCOPE_TYPES = ["agent", "application", "entitlement", "privileged_access", "high_risk_agent", "identity_access", "role_assignments", "package_contents", "application_contents"] as const;
const REVIEWER_KINDS = ["named", "manager", "application_owner"] as const;
const CADENCES = ["one_time", "periodic", "event_driven"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TemplateInput = { name?: unknown; scopeType?: unknown; scope?: unknown; reviewerKind?: unknown; reviewerId?: unknown; cadence?: unknown; dueInDays?: unknown };
export type ValidTemplate = {
  name: string;
  scope_type: (typeof SCOPE_TYPES)[number];
  scope: Record<string, unknown>;
  reviewer_kind: (typeof REVIEWER_KINDS)[number];
  reviewer_id: string | null;
  cadence: (typeof CADENCES)[number];
  due_in_days: number | null;
};

export function validateTemplate(input: TemplateInput): ValidTemplate | { error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 120) return { error: "name: 2 to 120 characters" };
  if (!(SCOPE_TYPES as readonly unknown[]).includes(input.scopeType)) return { error: "scopeType: one of the campaign scopes" };
  const scopeType = input.scopeType as ValidTemplate["scope_type"];
  const kind = input.reviewerKind === undefined || input.reviewerKind === null || input.reviewerKind === "" ? "named" : input.reviewerKind;
  if (!(REVIEWER_KINDS as readonly unknown[]).includes(kind)) return { error: "reviewerKind: named, manager or application_owner" };
  if (kind !== "named" && scopeType !== "identity_access" && scopeType !== "role_assignments") return { error: "reviewerKind: only people's access and WonderID roles take a manager or owner" };
  if (kind === "application_owner" && scopeType === "role_assignments") return { error: "reviewerKind: named or manager for WonderID roles" };
  const reviewerId = input.reviewerId === undefined || input.reviewerId === null || input.reviewerId === "" ? null : input.reviewerId;
  if (reviewerId !== null && (typeof reviewerId !== "string" || !UUID_RE.test(reviewerId))) return { error: "reviewerId: a member" };
  const cadence = input.cadence === undefined || input.cadence === null || input.cadence === "" ? "one_time" : input.cadence;
  if (!(CADENCES as readonly unknown[]).includes(cadence)) return { error: "cadence: one_time, periodic or event_driven" };
  let due: number | null = null;
  if (input.dueInDays !== undefined && input.dueInDays !== null && input.dueInDays !== "") {
    due = Number(input.dueInDays);
    if (!Number.isInteger(due) || due < 1 || due > 365) return { error: "dueInDays: 1 to 365" };
  }
  const raw = input.scope && typeof input.scope === "object" && !Array.isArray(input.scope) ? (input.scope as Record<string, unknown>) : {};
  const scope: Record<string, unknown> = {};
  if (raw.privilegedOnly === true) scope.privilegedOnly = true;
  for (const key of ["applicationId", "entitlementId"] as const) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    if (typeof raw[key] !== "string" || !UUID_RE.test(raw[key] as string)) return { error: `scope.${key}: an id` };
    scope[key] = raw[key];
  }
  if (Array.isArray(raw.criticality)) scope.criticality = raw.criticality.filter((c): c is string => typeof c === "string" && c.length <= 40).slice(0, 10);
  if (typeof raw.minRiskScore === "number" && raw.minRiskScore >= 0 && raw.minRiskScore <= 100) scope.minRiskScore = raw.minRiskScore;
  return { name, scope_type: scopeType, scope, reviewer_kind: kind as ValidTemplate["reviewer_kind"], reviewer_id: reviewerId as string | null, cadence: cadence as ValidTemplate["cadence"], due_in_days: due };
}

/** A launch from a template: dated name, due date from the template's days. */
export function launchFromTemplateInput(t: ValidTemplate, actorId: string, now: Date) {
  return {
    name: `${t.name} — ${now.toISOString().slice(0, 10)}`,
    scopeType: t.scope_type,
    scope: t.scope,
    cadence: t.cadence,
    reviewerKind: t.reviewer_kind,
    reviewerId: t.reviewer_id ?? actorId,
    dueDate: t.due_in_days ? new Date(now.getTime() + t.due_in_days * 86_400_000).toISOString() : undefined,
  };
}
