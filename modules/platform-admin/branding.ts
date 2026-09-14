import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { PlatformBranding } from "@/lib/shared/types/platform";
import { toPlatformBranding } from "./mappers";
import { writePlatformAudit } from "./auditLog";
import { recordConfigVersion } from "./configVersions";

export type UpdateBrandingInput = Partial<{
  productName: string;
  logoUrl: string;
  faviconUrl: string;
  supportUrl: string;
  docsUrl: string;
  defaultEmailSender: string;
  defaultTheme: "light" | "dark" | "system";
}>;

export async function getBranding(): Promise<PlatformBranding> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase.from("platform_branding").select().eq("id", true).single();
  if (error || !data) throw new ApiError(500, "QUERY_FAILED", error?.message ?? "Branding row missing");
  return toPlatformBranding(data);
}

export async function updateBranding(actorId: string, input: UpdateBrandingInput): Promise<PlatformBranding> {
  const supabase = supabaseServiceRole();
  const { data: previous } = await supabase.from("platform_branding").select().eq("id", true).single();

  const { data, error } = await supabase
    .from("platform_branding")
    .update({
      ...(input.productName !== undefined ? { product_name: input.productName } : {}),
      ...(input.logoUrl !== undefined ? { logo_url: input.logoUrl } : {}),
      ...(input.faviconUrl !== undefined ? { favicon_url: input.faviconUrl } : {}),
      ...(input.supportUrl !== undefined ? { support_url: input.supportUrl } : {}),
      ...(input.docsUrl !== undefined ? { docs_url: input.docsUrl } : {}),
      ...(input.defaultEmailSender !== undefined ? { default_email_sender: input.defaultEmailSender } : {}),
      ...(input.defaultTheme !== undefined ? { default_theme: input.defaultTheme } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true)
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to update branding");

  // PLATFORM-P0-05.3 — structured, diffable version history, distinct
  // from (and in addition to) the general platform_audit_logs entry below.
  await recordConfigVersion(actorId, "branding", null, previous ? toPlatformBranding(previous) : null, toPlatformBranding(data));
  await writePlatformAudit({ actorId, action: "platform.branding_updated", oldValue: previous, newValue: input, result: "success" });
  return toPlatformBranding(data);
}
