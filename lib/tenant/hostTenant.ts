import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { baseAppHost, parseTenantHost, tenantUrl, type HostTarget } from "./host";

/**
 * FOUNDATION-P0-22 — the tenant a request's hostname addresses, once per
 * request. The lookup (`resolve_tenant_host`, migration 0095) returns only
 * a tenant's public face — id, name, slug, status — for verified domains,
 * so it works before sign-in (the tenant's own sign-in page).
 *
 * This addresses a tenant; it never authorizes. getTenantContext() still
 * requires an active membership in the addressed tenant (non-negotiable
 * #2), and RLS still scopes every read to the memberships the database
 * says the user holds.
 */

export type HostTenant = { tenantId: string; name: string; slug: string; status: string };
export type HostResolution = { target: HostTarget; tenant: HostTenant | null };

export const getRequestHost = cache(async (): Promise<string | null> => {
  const h = await headers();
  return h.get("host");
});

export const getHostTenant = cache(async (): Promise<HostResolution> => {
  const target = parseTenantHost(await getRequestHost(), baseAppHost());
  if (target.kind !== "subdomain") return { target, tenant: null };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("resolve_tenant_host", { p_subdomain: target.label, p_hostname: null });
  // A failed lookup resolves nothing: the caller then denies (never falls back to another tenant).
  if (error) return { target, tenant: null };
  const row = (Array.isArray(data) ? data[0] : data) as { tenant_id: string; name: string; slug: string; status: string } | undefined;
  return { target, tenant: row ? { tenantId: row.tenant_id, name: row.name, slug: row.slug, status: row.status } : null };
});

/** The URL to reach a tenant at, on the current scheme and port (local development keeps its port). */
export async function urlForTenant(slug: string): Promise<string | null> {
  const host = (await getRequestHost()) ?? "";
  const port = /:(\d+)$/.exec(host)?.[1] ?? null;
  // The request's own scheme: Vercel sets x-forwarded-proto; a local server on localhost is plain http.
  const forwarded = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : /(^|\.)localhost(:\d+)?$/.test(host) ? "http" : "https";
  return tenantUrl(slug, baseAppHost(), protocol, port);
}
