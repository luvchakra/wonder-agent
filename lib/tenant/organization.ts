import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ORGANIZATION_NAME_MAX } from "./organizationName";

export type RenameResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Renames the caller's organization (Administration → Organization). The
 * caller has already passed requirePermission("tenant.settings"); `tenantId`
 * is that server-resolved context, never a client value (non-negotiable #2).
 *
 * Service role because `tenants` has no client UPDATE policy. The write is
 * pinned to `id = tenantId` and to an active organization, and reads the old
 * name back first so the audit event carries both (non-negotiable #11).
 * The slug — the organization's address — never changes here.
 */
export async function renameOrganization(tenantId: string, actorId: string, rawName: unknown): Promise<RenameResult> {
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2) return { ok: false, error: "Enter a name of at least 2 characters." };
  if (name.length > ORGANIZATION_NAME_MAX) return { ok: false, error: `Use at most ${ORGANIZATION_NAME_MAX} characters.` };

  const db = supabaseServiceRole();
  const { data: current, error: readError } = await db.from("tenants").select("id, name").eq("id", tenantId).eq("status", "active").maybeSingle();
  if (readError) return { ok: false, error: "The organization could not be read. Try again." };
  if (!current) return { ok: false, error: "This organization is not active." };
  if (current.name === name) return { ok: true, name };

  const { data: updated, error } = await db
    .from("tenants")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", tenantId)
    .eq("status", "active")
    .select("id");
  if (error || !updated?.length) return { ok: false, error: "The name could not be saved. Try again." };

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "tenant.renamed",
    objectType: "tenant",
    objectId: tenantId,
    outcome: "success",
    metadata: { from: current.name, to: name },
  });
  return { ok: true, name };
}
