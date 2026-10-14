import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { CertificationCampaign } from "@/lib/shared/types/compliance";
import { launchCampaign } from "./campaigns";
import { launchFromTemplateInput, validateTemplate, type TemplateInput, type ValidTemplate } from "./templateRules";

/**
 * COMPLIANCE-P0-14 part 1 — campaign templates. Read as the caller (RLS,
 * filtered by tenant); written with the service role, filtered by the
 * tenant resolved for the request (§14); audited. Archived, never deleted:
 * a campaign launched from one keeps its name in the audit trail.
 */

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CampaignTemplate = {
  id: string;
  name: string;
  scopeType: string;
  scope: Record<string, unknown>;
  reviewerKind: string;
  reviewerId: string | null;
  cadence: string;
  dueInDays: number | null;
  createdAt: string;
};

function toTemplate(r: Row): CampaignTemplate {
  return {
    id: r.id as string,
    name: r.name as string,
    scopeType: r.scope_type as string,
    scope: (r.scope as Record<string, unknown>) ?? {},
    reviewerKind: r.reviewer_kind as string,
    reviewerId: (r.reviewer_id as string | null) ?? null,
    cadence: r.cadence as string,
    dueInDays: (r.due_in_days as number | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function listCampaignTemplates(tenantId: string): Promise<CampaignTemplate[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("certification_campaign_templates").select("*").eq("tenant_id", tenantId).is("archived_at", null).order("name").limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return ((data ?? []) as Row[]).filter((r) => r.tenant_id === tenantId).map(toTemplate);
}

export async function saveCampaignTemplate(tenantId: string, actorId: string, input: TemplateInput): Promise<CampaignTemplate> {
  const v = validateTemplate(input);
  if ("error" in v) throw new ApiError(400, "VALIDATION_FAILED", v.error);
  const { data, error } = await supabaseServiceRole()
    .from("certification_campaign_templates")
    .insert({ tenant_id: tenantId, ...v, created_by: actorId })
    .select("*")
    .single();
  if (error?.code === "23505") throw new ApiError(409, "DUPLICATE_NAME", "A template with this name already exists");
  if (error || !data) throw new ApiError(500, "WRITE_FAILED", error?.message ?? "Could not save");
  await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.template_saved", objectType: "certification_campaign_template", objectId: data.id as string, outcome: "success", metadata: { scopeType: v.scope_type, reviewerKind: v.reviewer_kind } });
  return toTemplate(data);
}

async function readTemplate(tenantId: string, templateId: string): Promise<Row> {
  if (!UUID_RE.test(templateId)) throw new ApiError(404, "NOT_FOUND", "No such template");
  const { data, error } = await supabaseServiceRole().from("certification_campaign_templates").select("*").eq("tenant_id", tenantId).eq("id", templateId).is("archived_at", null).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "NOT_FOUND", "No such template");
  return data as Row;
}

export async function archiveCampaignTemplate(tenantId: string, actorId: string, templateId: string): Promise<void> {
  await readTemplate(tenantId, templateId);
  const { error } = await supabaseServiceRole().from("certification_campaign_templates").update({ archived_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", templateId);
  if (error) throw new ApiError(500, "WRITE_FAILED", error.message);
  await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.template_archived", objectType: "certification_campaign_template", objectId: templateId, outcome: "success" });
}

/** Starts an ordinary campaign from the template (validated again, as the template may predate a rule). */
export async function launchCampaignFromTemplate(tenantId: string, actorId: string, templateId: string, now = new Date()): Promise<CertificationCampaign> {
  const row = await readTemplate(tenantId, templateId);
  const v = validateTemplate({ name: row.name, scopeType: row.scope_type, scope: row.scope, reviewerKind: row.reviewer_kind, reviewerId: row.reviewer_id, cadence: row.cadence, dueInDays: row.due_in_days });
  if ("error" in v) throw new ApiError(409, "TEMPLATE_INVALID", v.error);
  const campaign = await launchCampaign(tenantId, actorId, launchFromTemplateInput(v as ValidTemplate, actorId, now));
  await writeAudit({ tenantId, actorId, actorType: "user", action: "compliance.template_launched", objectType: "certification_campaign_template", objectId: templateId, outcome: "success", metadata: { campaignId: campaign.id } });
  return campaign;
}
