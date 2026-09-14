import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { encryptSecret, decryptSecret } from "@/lib/security/encryptSecret";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AuthType } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-01.2 (higher bar). `integration_credentials` grants no
 * client-facing policy at all (migration 0021) — every function here uses
 * the service-role client, and therefore must verify tenant ownership
 * itself (RLS isn't doing that job). The plaintext secret never appears in
 * a return value, a log line, or is reachable from any API response —
 * callers get back only `{ ok: true }`.
 */
export async function setCredential(
  tenantId: string,
  actorId: string,
  integrationId: string,
  authType: AuthType,
  plaintextSecret: string,
): Promise<void> {
  const supabase = supabaseServiceRole();

  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .select("id")
    .eq("id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (integrationError) throw new ApiError(500, "QUERY_FAILED", integrationError.message);
  if (!integration) throw new ApiError(404, "INTEGRATION_NOT_FOUND");

  const encrypted = await encryptSecret(plaintextSecret);

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("integration_id")
    .eq("integration_id", integrationId)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("integration_credentials")
        .update({ auth_type: authType, encrypted_secret: encrypted, rotated_at: new Date().toISOString() })
        .eq("integration_id", integrationId)
    : await supabase
        .from("integration_credentials")
        .insert({ integration_id: integrationId, tenant_id: tenantId, auth_type: authType, encrypted_secret: encrypted });

  if (error) throw new ApiError(500, "CREATE_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: existing ? "integration.credential_rotated" : "integration.credential_set",
    objectType: "integration",
    objectId: integrationId,
    outcome: "success",
    metadata: { authType }, // never the secret itself
  });
}

/**
 * Internal use only (this module's own connector-invocation paths) — never
 * exported via modules/integrations/service.ts. Returns null if no
 * credential is configured (some connectors, e.g. an unauthenticated
 * webhook source, may not need one).
 */
export async function getDecryptedCredential(
  tenantId: string,
  integrationId: string,
): Promise<string | null> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("encrypted_secret")
    .eq("integration_id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  return decryptSecret(data.encrypted_secret);
}
