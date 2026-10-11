import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { IdentityType } from "@/lib/shared/types/agent-identity";
import { resolveOwner, type PersonRef } from "./accountIdentityRules";

/**
 * IDENTITY-P0-20 — the governed identities behind non-human accounts
 * (service, shared, machine, workload, application and API accounts that
 * belong to no person), and the identifiers declared on AI agents that
 * link an agent's accounts to it.
 *
 * Called by Access's account reconciliation, which may run with no session
 * (after a scheduled sync), so this uses the service role; `tenantId` is
 * the reconciled application's own tenant and every statement names it
 * (§14). Identity rows stay owned by this module (#5).
 */

export type NonHumanType = Extract<IdentityType, "SERVICE_ACCOUNT" | "MACHINE" | "WORKLOAD" | "APPLICATION" | "API">;
export type AccountIdentityInput = { ref: string; displayName: string; identityType: NonHumanType; ownerRef: string | null };

const CHUNK = 200;
type Row = Record<string, unknown>;

/** The source system an account-born identity records: one per application. */
export const accountSourceSystem = (applicationId: string) => `account:${applicationId}`;

/**
 * The identity for each non-human account, keyed by the account's key:
 * found by the application and key it was created from, or created. An
 * owner named by the source (resolved to exactly one person) is set when
 * the identity has none; an owner someone set in WonderID is never
 * replaced. Unowned identities appear in the unowned queue.
 */
export async function ensureAccountIdentities(tenantId: string, applicationId: string, items: AccountIdentityInput[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!items.length) return out;
  const admin = supabaseServiceRole();
  const source = accountSourceSystem(applicationId);
  const refs = [...new Set(items.map((i) => i.ref))];

  const existing = new Map<string, { id: string; owner: string | null }>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { data, error } = await admin
      .from("identities")
      .select("id, tenant_id, source_native_id, owner_identity_id")
      .eq("tenant_id", tenantId)
      .eq("source_system", source)
      .in("source_native_id", refs.slice(i, i + CHUNK));
    if (error) throw new ApiError(500, "QUERY_FAILED", `identities: ${error.message}`);
    for (const r of (data ?? []) as Row[]) {
      if (r.tenant_id === tenantId) existing.set(r.source_native_id as string, { id: r.id as string, owner: (r.owner_identity_id as string | null) ?? null });
    }
  }

  const people: PersonRef[] = [];
  if (items.some((i) => i.ownerRef)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("identities")
        .select("id, tenant_id, email, username, source_native_id")
        .eq("tenant_id", tenantId)
        .in("identity_type", ["HUMAN", "EXTERNAL"])
        .eq("status", "active")
        .order("id")
        .range(from, from + 999);
      if (error) throw new ApiError(500, "QUERY_FAILED", `identities: ${error.message}`);
      for (const r of (data ?? []) as Row[]) {
        if (r.tenant_id === tenantId) people.push({ id: r.id as string, email: (r.email as string | null) ?? null, username: (r.username as string | null) ?? null, sourceNativeId: (r.source_native_id as string | null) ?? null });
      }
      if (!data || data.length < 1000) break;
    }
  }

  const created: string[] = [];
  const ownerSet: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.ref)) continue;
    seen.add(item.ref);
    const owner = resolveOwner(item.ownerRef, people);
    const current = existing.get(item.ref);
    if (current) {
      out.set(item.ref, current.id);
      if (!current.owner && owner) {
        const { error } = await admin.from("identities").update({ owner_identity_id: owner, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", current.id).is("owner_identity_id", null);
        if (!error) ownerSet.push(current.id);
      }
      continue;
    }
    const { data, error } = await admin
      .from("identities")
      .insert({
        tenant_id: tenantId,
        identity_type: item.identityType,
        display_name: item.displayName.slice(0, 200) || item.ref.slice(0, 200),
        username: item.ref.slice(0, 200),
        status: "active",
        source_system: source,
        source_native_id: item.ref.slice(0, 300),
        owner_identity_id: owner,
      })
      .select("id")
      .single();
    if (error || !data) throw new ApiError(500, "WRITE_FAILED", `identities: ${error?.message ?? "insert failed"}`);
    out.set(item.ref, data.id as string);
    created.push(data.id as string);
    if (owner) ownerSet.push(data.id as string);
  }

  if (created.length || ownerSet.length) {
    await writeAudit({
      tenantId,
      actorType: "system",
      action: "identity.created_from_accounts",
      objectType: "application",
      objectId: applicationId,
      outcome: "success",
      metadata: { created: created.slice(0, 500), ownerFromSource: ownerSet.slice(0, 500) },
    });
  }
  return out;
}

/**
 * The identifiers declared on AI agents (OAuth client id, service
 * principal id, external id: `agent_identities.external_reference`), to the
 * agent that holds each. An identifier two agents both declare links
 * neither: an account is never given to the wrong agent.
 */
export async function listAgentIdentifiers(tenantId: string): Promise<Map<string, string>> {
  const { data, error } = await supabaseServiceRole()
    .from("agent_identities")
    .select("tenant_id, agent_id, external_reference, status")
    .eq("tenant_id", tenantId)
    // A human delegate is a person's account the agent acts through; it stays the person's.
    .neq("identity_type", "human_delegate")
    .not("external_reference", "is", null)
    .limit(10_000);
  if (error) throw new ApiError(500, "QUERY_FAILED", `agent_identities: ${error.message}`);
  const out = new Map<string, string>();
  const clash = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    if (r.tenant_id !== tenantId || r.status === "removed") continue;
    const ref = String(r.external_reference).trim();
    if (!ref) continue;
    if (out.has(ref) && out.get(ref) !== r.agent_id) clash.add(ref);
    out.set(ref, r.agent_id as string);
  }
  for (const ref of clash) out.delete(ref);
  return out;
}
