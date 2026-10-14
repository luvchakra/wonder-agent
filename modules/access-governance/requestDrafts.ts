import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { validateDraft, type DraftPayload } from "./requestBasketRules";

/**
 * ACCESS-P0-38 part 2 — a member's saved baskets, to send later. Each
 * member sees and changes only their own (RLS on read; the service checks
 * tenant and owner on every write). A draft sends nothing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DRAFTS = 20;
export type RequestDraft = { id: string; name: string; payload: DraftPayload; updatedAt: string };

export async function listRequestDrafts(tenantId: string, userId: string): Promise<RequestDraft[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("access_request_drafts")
    .select("id, tenant_id, user_id, name, payload, updated_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_DRAFTS);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? [])
    .filter((r) => r.tenant_id === tenantId && r.user_id === userId)
    .map((r) => ({ id: r.id as string, name: r.name as string, payload: r.payload as DraftPayload, updatedAt: r.updated_at as string }));
}

/** Saves a new draft, or replaces the caller's own draft `draftId`. */
export async function saveRequestDraft(tenantId: string, userId: string, input: { name?: unknown; payload?: unknown }, draftId?: string): Promise<RequestDraft> {
  const v = validateDraft(input);
  if ("error" in v) throw new ApiError(400, "VALIDATION_FAILED", v.error);
  const admin = supabaseServiceRole();
  const now = new Date().toISOString();
  if (draftId) {
    if (!UUID_RE.test(draftId)) throw new ApiError(404, "NOT_FOUND", "No such draft");
    const { data, error } = await admin
      .from("access_request_drafts")
      .update({ ...v, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("id", draftId)
      .select("id, name, payload, updated_at")
      .maybeSingle();
    if (error) throw new ApiError(500, "WRITE_FAILED", error.message);
    if (!data) throw new ApiError(404, "NOT_FOUND", "No such draft");
    return { id: data.id as string, name: data.name as string, payload: data.payload as DraftPayload, updatedAt: data.updated_at as string };
  }
  const { count, error: countError } = await admin.from("access_request_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("user_id", userId);
  if (countError) throw new ApiError(500, "QUERY_FAILED", countError.message);
  if ((count ?? 0) >= MAX_DRAFTS) throw new ApiError(409, "TOO_MANY_DRAFTS", `At most ${MAX_DRAFTS} drafts; delete one first`);
  const { data, error } = await admin
    .from("access_request_drafts")
    .insert({ tenant_id: tenantId, user_id: userId, ...v })
    .select("id, name, payload, updated_at")
    .single();
  if (error || !data) throw new ApiError(500, "WRITE_FAILED", error?.message ?? "Could not save the draft");
  return { id: data.id as string, name: data.name as string, payload: data.payload as DraftPayload, updatedAt: data.updated_at as string };
}

export async function deleteRequestDraft(tenantId: string, userId: string, draftId: string): Promise<void> {
  if (!UUID_RE.test(draftId)) throw new ApiError(404, "NOT_FOUND", "No such draft");
  const { data, error } = await supabaseServiceRole().from("access_request_drafts").delete().eq("tenant_id", tenantId).eq("user_id", userId).eq("id", draftId).select("id");
  if (error) throw new ApiError(500, "WRITE_FAILED", error.message);
  if (!data?.length) throw new ApiError(404, "NOT_FOUND", "No such draft");
}
