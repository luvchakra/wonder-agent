import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ReportType, SavedReportDefinition } from "@/lib/shared/types/operations";
import { toSavedReportDefinition } from "./mappers";

export type SaveReportDefinitionInput = { reportType: ReportType; name: string; filters?: Record<string, unknown> };

/** Saved report *definitions* only (filter + format) — see reports.ts for the live-computed output itself. */
export async function saveReportDefinition(tenantId: string, actorId: string, input: SaveReportDefinitionInput): Promise<SavedReportDefinition> {
  if (!input.name.trim()) throw new ApiError(400, "INVALID_INPUT", "name is required");

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("reports")
    .insert({ tenant_id: tenantId, report_type: input.reportType, name: input.name, filters: input.filters ?? {}, created_by: actorId })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to save report definition");

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "operations.report_definition_saved",
    objectType: "report",
    objectId: data.id,
    outcome: "success",
    metadata: { reportType: input.reportType, name: input.name },
  });

  return toSavedReportDefinition(data);
}

export async function listSavedReportDefinitions(tenantId: string): Promise<SavedReportDefinition[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("reports").select().eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toSavedReportDefinition);
}
