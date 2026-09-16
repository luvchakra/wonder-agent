import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { DEFAULT_LIST_LIMIT } from "@/lib/shared/pagination";
import { writePlatformAudit } from "./auditLog";

export type AnnouncementScope = "global" | "tenant";
export type AnnouncementType = "maintenance" | "notice";

export type PlatformAnnouncement = {
  id: string;
  scope: AnnouncementScope;
  tenantId: string | null;
  type: AnnouncementType;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string | null;
  createdBy: string;
  createdAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */
function toAnnouncement(row: any): PlatformAnnouncement {
  return {
    id: row.id,
    scope: row.scope,
    tenantId: row.tenant_id,
    type: row.type,
    title: row.title,
    body: row.body,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export type CreateAnnouncementInput = {
  scope: AnnouncementScope;
  tenantId?: string;
  type: AnnouncementType;
  title: string;
  body: string;
  startsAt?: string;
  endsAt?: string;
};

/**
 * PLATFORM-P0-05.4. Platform Agent owns the admin-side data model and
 * management (this file); Experience Agent owns rendering a notice inside
 * customer-facing UI, per the existing ownership-map split — this module
 * only publishes `getActiveAnnouncements()` below for Experience Agent to
 * eventually consume, and never reaches into `app/(customer)/*` itself
 * (non-negotiable #6/#18).
 */
export async function createAnnouncement(actorId: string, input: CreateAnnouncementInput): Promise<PlatformAnnouncement> {
  if (!input.title.trim() || !input.body.trim()) throw new ApiError(400, "INVALID_INPUT", "title and body are required");
  if (input.scope === "tenant" && !input.tenantId) throw new ApiError(400, "INVALID_INPUT", "tenantId is required for a tenant-scoped announcement");

  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("platform_announcements")
    .insert({
      scope: input.scope,
      tenant_id: input.scope === "tenant" ? input.tenantId : null,
      type: input.type,
      title: input.title,
      body: input.body,
      starts_at: input.startsAt ?? new Date().toISOString(),
      ends_at: input.endsAt ?? null,
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to create announcement");

  await writePlatformAudit({
    actorId,
    tenantId: input.scope === "tenant" ? input.tenantId : null,
    action: "platform.announcement_created",
    newValue: { scope: input.scope, type: input.type, title: input.title, startsAt: data.starts_at, endsAt: data.ends_at },
    result: "success",
  });

  return toAnnouncement(data);
}

/** Platform-admin UI surface: every announcement, most recent first. */
export async function listAnnouncements(): Promise<PlatformAnnouncement[]> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("platform_announcements").select().order("starts_at", { ascending: false }).limit(DEFAULT_LIST_LIMIT);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAnnouncement);
}

/**
 * Published read contract for Experience Agent (customer shell) to
 * consume, per this story's own cross-module note. Returns every
 * currently-active announcement visible to this tenant: global scope, or
 * this tenant's own, whose window (`starts_at`..`ends_at`, `ends_at` null
 * meaning open-ended) includes now.
 */
export async function getActiveAnnouncements(tenantId: string): Promise<PlatformAnnouncement[]> {
  const supabase = supabaseServiceRole();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("platform_announcements")
    .select()
    .or(`scope.eq.global,tenant_id.eq.${tenantId}`)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .order("starts_at", { ascending: false });
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAnnouncement);
}
