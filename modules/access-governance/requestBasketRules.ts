/**
 * ACCESS-P0-38 (design §5.3) — request baskets and model-after, pure (#9).
 * A basket is many lines (access to add or remove, an account to disable)
 * for one or many people, sent together; each line for each person is its
 * own request, checked and approved on its own route as any request is.
 * Model-after proposes the lines that give a person the requestable access
 * another person has, minus what they already have or have asked for.
 */

export const BASKET_LIMITS = { subjects: 50, lines: 20, requests: 200 } as const;
export type BasketRequestType = "grant" | "remove" | "disable_account";
export type BasketLine = { applicationId: string; entitlementId: string | null; requestType: BasketRequestType; durationDays: number | null };
export type ValidBasket = { subjects: string[]; lines: BasketLine[]; justification: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: readonly string[] = ["grant", "remove", "disable_account"];

/** Shape checks; each request is then checked by the same rules as a single one. Duplicate subjects and lines are dropped. */
export function validateBasket(input: { subjectIdentityIds?: unknown; lines?: unknown; justification?: unknown }): ValidBasket | { error: string } {
  const rawSubjects = input.subjectIdentityIds;
  if (!Array.isArray(rawSubjects) || rawSubjects.length < 1) return { error: "subjectIdentityIds: one or more people" };
  if (!rawSubjects.every((s) => typeof s === "string" && UUID_RE.test(s))) return { error: "subjectIdentityIds: identity ids" };
  const subjects = [...new Set(rawSubjects as string[])];
  if (subjects.length > BASKET_LIMITS.subjects) return { error: `subjectIdentityIds: at most ${BASKET_LIMITS.subjects} people` };

  if (!Array.isArray(input.lines) || input.lines.length < 1) return { error: "lines: one or more" };
  const lines: BasketLine[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of (input.lines as unknown[]).entries()) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o.applicationId !== "string" || !UUID_RE.test(o.applicationId)) return { error: `lines.${i}.applicationId: an application` };
    const entitlementId = o.entitlementId === undefined || o.entitlementId === null || o.entitlementId === "" ? null : o.entitlementId;
    if (entitlementId !== null && (typeof entitlementId !== "string" || !UUID_RE.test(entitlementId))) return { error: `lines.${i}.entitlementId: an entitlement, or empty for an account` };
    const requestType = o.requestType === undefined || o.requestType === null || o.requestType === "" ? "grant" : o.requestType;
    if (!TYPES.includes(requestType as string)) return { error: `lines.${i}.requestType: grant, remove or disable_account` };
    let durationDays: number | null = null;
    if (o.durationDays !== undefined && o.durationDays !== null && o.durationDays !== "") {
      durationDays = Number(o.durationDays);
      if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) return { error: `lines.${i}.durationDays: whole days from 1 to 3650, or empty` };
    }
    const key = `${o.applicationId}|${entitlementId ?? ""}|${requestType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ applicationId: o.applicationId, entitlementId: entitlementId as string | null, requestType: requestType as BasketRequestType, durationDays });
  }
  if (lines.length > BASKET_LIMITS.lines) return { error: `lines: at most ${BASKET_LIMITS.lines}` };
  if (subjects.length * lines.length > BASKET_LIMITS.requests) return { error: `At most ${BASKET_LIMITS.requests} requests in one basket (people × lines)` };
  const justification = typeof input.justification === "string" ? input.justification.trim().slice(0, 2000) : "";
  return { subjects, lines, justification };
}

export type HeldAccess = {
  entitlementId: string;
  entitlementName: string;
  applicationId: string;
  applicationName: string;
  requestable: boolean;
  applicationActive: boolean;
};

export type ModelAfterResult = {
  lines: (HeldAccess & { requestType: "grant" })[];
  skipped: { entitlementId: string; entitlementName: string; applicationName: string; reason: string }[];
};

/**
 * The lines that give the subject the model's requestable access: what the
 * subject already has or has asked for is left out, as is anything not
 * requestable or on an application not live. Every exclusion says why.
 */
export function modelAfterLines(model: HeldAccess[], subjectHas: Set<string>, subjectAsked: Set<string>): ModelAfterResult {
  const out: ModelAfterResult = { lines: [], skipped: [] };
  const seen = new Set<string>();
  for (const a of [...model].sort((x, y) => x.applicationName.localeCompare(y.applicationName) || x.entitlementName.localeCompare(y.entitlementName))) {
    if (seen.has(a.entitlementId)) continue;
    seen.add(a.entitlementId);
    const skip = (reason: string) => out.skipped.push({ entitlementId: a.entitlementId, entitlementName: a.entitlementName, applicationName: a.applicationName, reason });
    if (subjectHas.has(a.entitlementId)) skip("already has it");
    else if (subjectAsked.has(a.entitlementId)) skip("already asked for");
    else if (!a.applicationActive) skip("the application is not live");
    else if (!a.requestable) skip("not requestable");
    else out.lines.push({ ...a, requestType: "grant" });
  }
  return out;
}

export type BasketItemResult = { subjectIdentityId: string; line: number; ok: boolean; requestId?: string; status?: string; duplicate?: boolean; code?: string; message?: string };

/** How a basket went: requests made, open ones returned, refusals, by code. */
export function summarizeBasket(results: BasketItemResult[]): { created: number; existing: number; refused: number; byCode: Record<string, number> } {
  const byCode: Record<string, number> = {};
  let created = 0;
  let existing = 0;
  let refused = 0;
  for (const r of results) {
    if (r.ok && r.duplicate) existing++;
    else if (r.ok) created++;
    else {
      refused++;
      const code = r.code ?? "ERROR";
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
  }
  return { created, existing, refused, byCode };
}

export type DraftPayload = { subjectIdentityIds: string[]; items: string[]; justification: string };

/**
 * ACCESS-P0-38 part 2: a saved basket may be unfinished, but it stays a
 * basket's shape and size: people (identity ids) and items
 * ("<application>|<entitlement or empty>"), plus the reason.
 */
export function validateDraft(input: { name?: unknown; payload?: unknown }): { name: string; payload: DraftPayload } | { error: string } {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
  if (!name) return { error: "name: give the draft a name" };
  const p = (input.payload ?? {}) as Record<string, unknown>;
  const subjects = Array.isArray(p.subjectIdentityIds) ? p.subjectIdentityIds : [];
  const items = Array.isArray(p.items) ? p.items : [];
  if (subjects.length > BASKET_LIMITS.subjects || !subjects.every((s) => typeof s === "string" && UUID_RE.test(s))) return { error: `payload.subjectIdentityIds: at most ${BASKET_LIMITS.subjects} identity ids` };
  if (items.length > BASKET_LIMITS.lines || !items.every((i) => typeof i === "string" && /^[0-9a-f-]{36}\|([0-9a-f-]{36})?$/i.test(i))) return { error: `payload.items: at most ${BASKET_LIMITS.lines} items` };
  const justification = typeof p.justification === "string" ? p.justification.slice(0, 2000) : "";
  return { name, payload: { subjectIdentityIds: [...new Set(subjects as string[])], items: [...new Set(items as string[])], justification } };
}
