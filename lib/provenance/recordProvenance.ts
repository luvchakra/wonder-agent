import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import { PROVENANCE_TABLES, type ProvenanceTable } from "./tables";

/**
 * Who created and last changed an object, for its page (owner decision,
 * 2026-10-10; migration 0115). Read as the signed-in user under RLS, from
 * a table on the fixed list, filtered on the tenant as well (§14); a
 * record the user may not see yields null. `key` names the column the id
 * matches (a membership is found by its user_id). Names come from the users
 * table; a person who left is "a former member", never blank.
 */
export type RecordProvenance = {
  createdAt: string | null;
  createdBy: { id: string; name: string } | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};

type Row = { created_at?: string | null; updated_at?: string | null; created_by?: string | null; updated_by?: string | null };

export async function getRecordProvenance(tenantId: string, table: ProvenanceTable, id: string, key: "id" | "user_id" = "id"): Promise<RecordProvenance | null> {
  if (!PROVENANCE_TABLES.includes(table)) throw new ApiError(400, "INVALID_INPUT", `No provenance for ${table}`);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from(table).select("created_at, updated_at, created_by, updated_by").eq("tenant_id", tenantId).eq(key, id).limit(1).maybeSingle<Row>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  const ids = [...new Set([data.created_by, data.updated_by].filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (ids.length) {
    // users is global (no tenant_id); only the two ids named on this row are looked up, and only for their names.
    const { data: people } = await supabaseServiceRole().from("users").select("id, email, display_name").in("id", ids);
    for (const p of (people ?? []) as { id: string; email: string | null; display_name: string | null }[]) names.set(p.id, p.display_name || p.email || "A former member");
  }
  const person = (uid: string | null | undefined) => (uid ? { id: uid, name: names.get(uid) ?? "A former member" } : null);
  return {
    createdAt: data.created_at ?? null,
    createdBy: person(data.created_by),
    updatedAt: data.updated_at ?? null,
    updatedBy: person(data.updated_by),
  };
}
