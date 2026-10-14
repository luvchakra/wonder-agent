import { notFound, redirect } from "next/navigation";
import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";

/**
 * FOUNDATION-P0-34 (CLAUDE.md §19.13): every key shown in a URL is the
 * object's short number per organization (`ref`, migration 0192), never its
 * UUID. A page takes the number from its URL, finds the row within the
 * session's tenant as the user (RLS applies, non-negotiable #2), and works
 * with the UUID from there. An old link with a UUID still works: it is
 * redirected to the number URL.
 */

/** The object tables that carry `ref` (migration 0192). */
export const REF_TABLES = [
  "accounts",
  "agents",
  "applications",
  "entitlement_classification_rules",
  "application_onboarding_templates",
  "access_packages",
  "access_requests",
  "certification_campaigns",
  "certification_consultations",
  "identities",
  "lifecycle_rules",
  "integrations",
  "application_discoveries",
  "identity_sources",
  "identity_reconciliation_runs",
  "policies",
  "investigations",
  "risk_findings",
  "authorization_policies",
  "groups",
  "privacy_breach_incidents",
  "privacy_requests",
  "roles",
  "tenant_memberships",
] as const;
export type RefTable = (typeof REF_TABLES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RefParam = { kind: "ref"; ref: number } | { kind: "uuid"; id: string };

/** A URL segment: a positive whole number (the key) or, from an old link, a UUID. */
export function parseRefParam(raw: string | undefined | null): RefParam | null {
  const s = decodeURIComponent(String(raw ?? "")).trim();
  if (/^[1-9][0-9]{0,15}$/.test(s)) return { kind: "ref", ref: Number(s) };
  if (UUID_RE.test(s)) return { kind: "uuid", id: s.toLowerCase() };
  return null;
}

export type ResolvedRef = { id: string; ref: number; fromUuid: boolean };

/**
 * The row a URL segment names, within this tenant, read as the user. Roles
 * include the built-in ones (no tenant). Null when it is not there or not
 * visible to the user. `idColumn` is the column returned as `id` (the
 * member's user id for `tenant_memberships`).
 */
export async function resolveRef(tenantId: string, table: RefTable, raw: string | undefined | null, idColumn = table === "tenant_memberships" ? "user_id" : "id"): Promise<ResolvedRef | null> {
  const param = parseRefParam(raw);
  if (!param) return null;
  const supabase = await supabaseServer();
  let query = supabase.from(table).select(`${idColumn}, ref`);
  query = table === "roles" ? query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : query.eq("tenant_id", tenantId);
  query = param.kind === "ref" ? query.eq("ref", param.ref) : query.eq(idColumn, param.id);
  const { data, error } = await query.limit(2);
  if (error || !data || data.length !== 1) return null;
  const row = data[0] as unknown as Record<string, unknown>;
  return { id: String(row[idColumn]), ref: Number(row.ref), fromUuid: param.kind === "uuid" };
}

/**
 * For a page: the UUID of the object its URL names. Not found → 404; an old
 * UUID link → redirected to `path(number)`, keeping the query string.
 */
export async function pageRef(tenantId: string, table: RefTable, raw: string | undefined | null, path: (ref: number) => string, search?: Record<string, string | string[] | undefined>, idColumn?: string): Promise<string> {
  const found = await resolveRef(tenantId, table, raw, idColumn);
  if (!found) notFound();
  if (found.fromUuid) redirect(path(found.ref) + queryString(search));
  return found.id;
}

/**
 * For a server action that only holds a UUID: the object's number for its
 * page URL, read as the user within the tenant. Falls back to the UUID (the
 * page redirects it) when the row is not readable.
 */
export async function refOf(tenantId: string, table: RefTable, id: string): Promise<string> {
  const found = await resolveRef(tenantId, table, id);
  return found ? String(found.ref) : id;
}

/**
 * Organizations in the platform console (vendor-only, after
 * requirePlatformAdmin): one global number per organization.
 */
export async function platformTenantRef(raw: string | undefined | null, path: (ref: number) => string): Promise<string> {
  const param = parseRefParam(raw);
  if (!param) notFound();
  const { data } = await supabaseServiceRole()
    .from("tenants")
    .select("id, ref")
    .eq(param.kind === "ref" ? "ref" : "id", param.kind === "ref" ? param.ref : param.id)
    .maybeSingle();
  if (!data) notFound();
  if (param.kind === "uuid") redirect(path(Number(data.ref)));
  return String(data.id);
}

function queryString(search?: Record<string, string | string[] | undefined>): string {
  if (!search) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else if (v !== undefined) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
