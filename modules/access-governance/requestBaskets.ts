import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { getIdentity, getIdentityForUser } from "@/modules/agent-identity/service";
import { submitAccessRequest, type RequestActor } from "./requestCatalog";
import { modelAfterLines, summarizeBasket, validateBasket, type BasketItemResult, type HeldAccess, type ModelAfterResult } from "./requestBasketRules";

/**
 * ACCESS-P0-38 (design §5.3) — request baskets and model-after.
 *
 * A basket sends many lines for one or many people. Every line for every
 * person goes through `submitAccessRequest`, the same deterministic checks
 * and approval routes as a single request (policy, scope to request for
 * others, requestable, duration, agent contract, SoD), and is reported on
 * its own: a refusal of one never hides or undoes another (§17.5).
 * Model-after reads, as the caller (RLS), what another person holds.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** People handled at once; one person's lines go in order, so an identical line meets the request just made. */
const PARALLEL_SUBJECTS = 4;

export type BasketResult = { basketId: string; results: BasketItemResult[]; summary: ReturnType<typeof summarizeBasket> };

export async function submitRequestBasket(tenantId: string, actor: RequestActor, input: { subjectIdentityIds?: unknown; lines?: unknown; justification?: unknown }): Promise<BasketResult> {
  const basket = validateBasket(input);
  if ("error" in basket) throw new ApiError(400, "VALIDATION_FAILED", basket.error);
  const basketId = randomUUID();
  const results: BasketItemResult[] = [];
  const queue = [...basket.subjects];
  const work = async () => {
    for (let subject = queue.shift(); subject; subject = queue.shift()) {
      for (const [line, l] of basket.lines.entries()) {
        try {
          const { request, duplicate } = await submitAccessRequest(
            tenantId,
            actor,
            {
              subjectIdentityId: subject,
              applicationId: l.applicationId,
              entitlementId: l.entitlementId,
              requestType: l.requestType,
              durationDays: l.durationDays,
              justification: basket.justification,
            },
            { basketId },
          );
          results.push({ subjectIdentityId: subject, line, ok: true, requestId: request.id, status: request.status, duplicate });
        } catch (err) {
          results.push({
            subjectIdentityId: subject,
            line,
            ok: false,
            code: err instanceof ApiError ? err.code : "ERROR",
            message: err instanceof ApiError ? err.message : "This request could not be sent",
          });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_SUBJECTS, basket.subjects.length) }, work));
  results.sort((a, b) => basket.subjects.indexOf(a.subjectIdentityId) - basket.subjects.indexOf(b.subjectIdentityId) || a.line - b.line);
  const summary = summarizeBasket(results);
  await writeAudit({
    tenantId,
    actorId: actor.userId,
    actorType: "user",
    action: "access.request_basket_submitted",
    objectType: "access_request_basket",
    objectId: basketId,
    outcome: summary.created + summary.existing > 0 ? "success" : "failure",
    metadata: { subjects: basket.subjects.length, lines: basket.lines.length, ...summary },
  });
  return { basketId, results, summary };
}

/** The access an identity holds now: live grants (not revoked or being removed) through its accounts. Read as the caller. */
async function heldAccess(tenantId: string, identityId: string): Promise<HeldAccess[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_grants")
    .select(
      "tenant_id, entitlement_id, revoked_at, removal_status, accounts!inner(identity_id), entitlements!inner(id, name, requestable, application_id, applications!inner(name, display_name, onboarding_status))",
    )
    .eq("tenant_id", tenantId)
    .eq("accounts.identity_id", identityId)
    .is("revoked_at", null)
    .limit(2000);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.tenant_id === tenantId && !r.removal_status)
    .map((r) => {
      const e = r.entitlements as Row;
      const app = e.applications as Row;
      return {
        entitlementId: e.id as string,
        entitlementName: e.name as string,
        applicationId: e.application_id as string,
        applicationName: ((app.display_name as string | null) ?? (app.name as string)) as string,
        requestable: e.requestable !== false,
        applicationActive: app.onboarding_status === "ACTIVE",
      };
    });
}

/**
 * "Give the subject the same access as the model": the model's requestable
 * access on live applications, minus what the subject holds or has asked
 * for. Seeing the model's access needs access.manage, or being the model
 * (or the model's manager). Proposes lines; sends nothing.
 */
export async function modelAfter(tenantId: string, actor: RequestActor, subjectId: unknown, modelId: unknown): Promise<ModelAfterResult> {
  if (typeof subjectId !== "string" || !UUID_RE.test(subjectId) || typeof modelId !== "string" || !UUID_RE.test(modelId))
    throw new ApiError(400, "VALIDATION_FAILED", "subject and model: identity ids");
  const [requester, subject, model] = await Promise.all([getIdentityForUser(tenantId, actor.userId), getIdentity(tenantId, subjectId), getIdentity(tenantId, modelId)]);
  if (!subject) throw new ApiError(404, "NOT_FOUND", "subject: no such identity in this organization");
  if (!model) throw new ApiError(404, "NOT_FOUND", "model: no such identity in this organization");
  const mayView = actor.canManageAccess || (requester !== null && (model.id === requester.id || model.managerIdentityId === requester.id));
  if (!mayView) throw new ApiError(403, "FORBIDDEN", "You can model after yourself or someone you manage; an access manager can model after anyone");
  const supabase = await supabaseServer();
  const [modelHeld, subjectHeld, asked] = await Promise.all([
    heldAccess(tenantId, model.id),
    heldAccess(tenantId, subject.id),
    supabase
      .from("access_requests")
      .select("tenant_id, entitlement_id")
      .eq("tenant_id", tenantId)
      .eq("subject_identity_id", subject.id)
      .eq("request_type", "grant")
      .in("status", ["pending", "approved"])
      .not("entitlement_id", "is", null)
      .limit(1000),
  ]);
  if (asked.error) throw new ApiError(500, "QUERY_FAILED", asked.error.message);
  const askedIds = new Set(((asked.data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map((r) => r.entitlement_id as string));
  return modelAfterLines(modelHeld, new Set(subjectHeld.map((h) => h.entitlementId)), askedIds);
}

export type BasketRequest = {
  id: string;
  subjectIdentityId: string | null;
  subjectName: string | null;
  applicationName: string | null;
  entitlementName: string | null;
  requestType: string;
  status: string;
};

/** A basket's requests, as the caller can see them (RLS), for following it as a whole. */
export async function listBasketRequests(tenantId: string, basketId: string): Promise<BasketRequest[]> {
  if (!UUID_RE.test(basketId)) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_requests")
    .select("id, tenant_id, subject_identity_id, request_type, status, subject:identities!access_requests_subject_fkey(display_name), applications(name, display_name), entitlements(name)")
    .eq("tenant_id", tenantId)
    .eq("basket_id", basketId)
    .order("created_at")
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.tenant_id === tenantId)
    .map((r) => ({
      id: r.id as string,
      subjectIdentityId: (r.subject_identity_id as string | null) ?? null,
      subjectName: ((r.subject as Row | null)?.display_name as string | null) ?? null,
      applicationName: (((r.applications as Row | null)?.display_name ?? (r.applications as Row | null)?.name) as string | null) ?? null,
      entitlementName: ((r.entitlements as Row | null)?.name as string | null) ?? null,
      requestType: r.request_type as string,
      status: r.status as string,
    }));
}
