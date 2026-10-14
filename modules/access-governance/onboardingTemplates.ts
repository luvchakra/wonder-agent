import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ApplicationOnboardingTemplate } from "@/lib/shared/types/access-governance";
import { getIdentity } from "@/modules/agent-identity/service";
import { validateTemplate, type TemplateInput, type ValidTemplate } from "./onboardingTemplateRules";

/**
 * ACCESS-P0-34 (design §5.8.2, §14) — application onboarding templates.
 *
 * Reads run as the caller (RLS) with an explicit tenant filter. Writes use
 * the service role, because members cannot write the table directly; every
 * statement filters on the tenant resolved for the request, and the route
 * checks access.manage first.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toTemplate(r: Row): ApplicationOnboardingTemplate {
  const defaults = (r.defaults as ValidTemplate["defaults"] | null) ?? { config: {}, businessOwnerIdentityId: null, technicalOwnerIdentityId: null };
  return {
    id: r.id as string,
    ref: (r.ref as number | null) ?? null,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    connectionTypeKey: (r.connection_type_key as string | null) ?? null,
    defaults: { config: defaults.config ?? {}, businessOwnerIdentityId: defaults.businessOwnerIdentityId ?? null, technicalOwnerIdentityId: defaults.technicalOwnerIdentityId ?? null },
    entitlementTypes: ((r.entitlement_types as ValidTemplate["entitlement_types"]) ?? []).map((t) => ({
      name: t.name,
      requestMode: t.request_mode ?? "single",
      certifiable: t.certifiable ?? true,
      defaultDurationDays: t.default_duration_days ?? null,
      maxDurationDays: t.max_duration_days ?? null,
    })),
    questions: (r.questions as ValidTemplate["questions"]) ?? [],
    status: r.status as ApplicationOnboardingTemplate["status"],
    updatedAt: r.updated_at as string,
  };
}

/** The stored shape again, for merging a change onto it. */
function toValid(r: Row): ValidTemplate {
  return {
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    connection_type_key: (r.connection_type_key as string | null) ?? null,
    defaults: r.defaults as ValidTemplate["defaults"],
    entitlement_types: (r.entitlement_types as ValidTemplate["entitlement_types"]) ?? [],
    questions: (r.questions as ValidTemplate["questions"]) ?? [],
  };
}

function writeError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new ApiError(409, "CONFLICT", "A template with this name already exists");
  if (error.code === "23503") throw new ApiError(404, "NOT_FOUND", "connectionTypeKey: no such connection type");
  if (error.code === "23514") throw new ApiError(400, "VALIDATION_FAILED", error.message);
  throw new ApiError(500, "WRITE_FAILED", error.message);
}

export async function listOnboardingTemplates(tenantId: string, opts: { includeRetired?: boolean } = {}): Promise<ApplicationOnboardingTemplate[]> {
  const supabase = await supabaseServer();
  let query = supabase.from("application_onboarding_templates").select("*").eq("tenant_id", tenantId);
  if (!opts.includeRetired) query = query.eq("status", "active");
  const { data, error } = await query.order("name").limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toTemplate);
}

export async function getOnboardingTemplate(tenantId: string, templateId: string): Promise<ApplicationOnboardingTemplate | null> {
  if (!UUID_RE.test(templateId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("application_onboarding_templates").select("*").eq("tenant_id", tenantId).eq("id", templateId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toTemplate(data) : null;
}

/** A template's owners are active people of this organization, as an application's are. */
async function assertOwners(tenantId: string, t: ValidTemplate) {
  for (const [field, id] of [
    ["businessOwnerIdentityId", t.defaults.businessOwnerIdentityId],
    ["technicalOwnerIdentityId", t.defaults.technicalOwnerIdentityId],
  ] as const) {
    if (!id) continue;
    const identity = await getIdentity(tenantId, id);
    if (!identity) throw new ApiError(404, "NOT_FOUND", `defaults.${field}: no such identity in this organization`);
    if (identity.identityType !== "HUMAN" || identity.status !== "active") throw new ApiError(400, "VALIDATION_FAILED", `defaults.${field}: must be an active person`);
  }
}

export async function createOnboardingTemplate(tenantId: string, actorId: string, input: TemplateInput): Promise<ApplicationOnboardingTemplate> {
  const v = validateTemplate(input);
  if ("error" in v) throw new ApiError(400, "VALIDATION_FAILED", v.error);
  await assertOwners(tenantId, v);
  const { data, error } = await supabaseServiceRole()
    .from("application_onboarding_templates")
    .insert({ tenant_id: tenantId, ...v, created_by: actorId, updated_by: actorId })
    .select("*")
    .single();
  if (error || !data) writeError(error ?? { message: "Could not add the template" });
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.onboarding_template_created",
    objectType: "onboarding_template",
    objectId: data.id as string,
    outcome: "success",
    metadata: { name: v.name, connectionTypeKey: v.connection_type_key, questions: v.questions.length, entitlementTypes: v.entitlement_types.length },
  });
  return toTemplate(data);
}

async function loadRow(tenantId: string, templateId: string): Promise<Row> {
  if (!UUID_RE.test(templateId)) throw new ApiError(404, "NOT_FOUND", "No such template");
  const { data, error } = await supabaseServiceRole().from("application_onboarding_templates").select("*").eq("tenant_id", tenantId).eq("id", templateId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such template");
  return data;
}

export async function updateOnboardingTemplate(tenantId: string, actorId: string, templateId: string, input: TemplateInput): Promise<ApplicationOnboardingTemplate> {
  const row = await loadRow(tenantId, templateId);
  if (row.status === "retired") throw new ApiError(409, "TEMPLATE_RETIRED", "A retired template cannot change");
  const v = validateTemplate(input, toValid(row));
  if ("error" in v) throw new ApiError(400, "VALIDATION_FAILED", v.error);
  await assertOwners(tenantId, v);
  const { data, error } = await supabaseServiceRole()
    .from("application_onboarding_templates")
    .update({ ...v, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", templateId)
    .eq("updated_at", row.updated_at as string)
    .select("*")
    .maybeSingle();
  if (error) writeError(error);
  if (!data) throw new ApiError(409, "CONFLICT", "The template changed meanwhile; reload");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "access.onboarding_template_updated",
    objectType: "onboarding_template",
    objectId: templateId,
    outcome: "success",
    metadata: { fields: Object.keys(input) },
  });
  return toTemplate(data);
}

/** Retired, it is no longer offered; onboardings that started from it keep their reference. */
export async function retireOnboardingTemplate(tenantId: string, actorId: string, templateId: string): Promise<ApplicationOnboardingTemplate> {
  const row = await loadRow(tenantId, templateId);
  if (row.status === "retired") return toTemplate(row);
  const { data, error } = await supabaseServiceRole()
    .from("application_onboarding_templates")
    .update({ status: "retired", updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", templateId)
    .select("*")
    .single();
  if (error || !data) writeError(error ?? { message: "Could not retire the template" });
  await writeAudit({ tenantId, actorId, actorType: "user", action: "access.onboarding_template_retired", objectType: "onboarding_template", objectId: templateId, outcome: "success", metadata: {} });
  return toTemplate(data);
}

/** The template an onboarding starts from: this organization's, and still offered. */
export async function templateForStart(tenantId: string, templateId: string): Promise<{ template: ApplicationOnboardingTemplate; stored: ValidTemplate }> {
  const row = await loadRow(tenantId, templateId);
  if (row.status !== "active") throw new ApiError(409, "TEMPLATE_RETIRED", "That template is retired");
  return { template: toTemplate(row), stored: toValid(row) };
}

/**
 * Declares the template's entitlement types on the application, with their
 * settings; a type the application already has keeps its own.
 */
export async function declareTemplateTypes(tenantId: string, applicationId: string, actorId: string, types: ValidTemplate["entitlement_types"]): Promise<number> {
  if (!types.length) return 0;
  const admin = supabaseServiceRole();
  const { data: existing, error } = await admin.from("application_entitlement_types").select("name").eq("tenant_id", tenantId).eq("application_id", applicationId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const known = new Set((existing ?? []).map((r) => String(r.name).toLowerCase()));
  const fresh = types.filter((t) => !known.has(t.name.toLowerCase()));
  if (!fresh.length) return 0;
  const { error: insertError } = await admin
    .from("application_entitlement_types")
    .insert(fresh.map((t) => ({ tenant_id: tenantId, application_id: applicationId, ...t, origin: "manual", created_by: actorId, updated_by: actorId })));
  // Declared a moment ago by an import: its own settings stay.
  if (insertError && insertError.code !== "23505") throw new ApiError(500, "WRITE_FAILED", insertError.message);
  return insertError ? 0 : fresh.length;
}
