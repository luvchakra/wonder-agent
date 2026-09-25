import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { encryptSecret, decryptSecret } from "@/lib/security/encryptSecret";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AuthType } from "@/lib/shared/types/integrations";
import { createConnector } from "./registry";

/**
 * INTEGRATION-P0-01.2 (higher bar) / INTEGRATION-P0-05.1 (verified
 * rotation). `integration_credentials` grants no client-facing policy at
 * all (migration 0021) — every function here uses the service-role client,
 * and therefore must verify tenant ownership itself (RLS isn't doing that
 * job). The plaintext secret never appears in a return value, a log line,
 * or is reachable from any API response — callers get back only
 * `{ ok: true }`.
 *
 * Before persisting, the *new* credential is tested against the
 * integration's own connector (the same `authenticate()`+`testConnection()`
 * call `testIntegrationConnection()` already uses). A failed test throws
 * without writing anything — the previously-stored encrypted secret (if
 * any) is left byte-for-byte untouched, so a bad replacement can never
 * clobber a working credential. Integration types with no pull connector
 * (e.g. `webhook`, which stores a signing secret rather than an outbound
 * API credential — see registry.ts) have nothing to test against, so the
 * verification step is skipped for them rather than failing spuriously.
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
    .select("id, integration_type_id, config")
    .eq("id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (integrationError) throw new ApiError(500, "QUERY_FAILED", integrationError.message);
  if (!integration) throw new ApiError(404, "INTEGRATION_NOT_FOUND");

  let connector;
  try {
    connector = createConnector(integration.integration_type_id);
  } catch {
    connector = null;
  }
  if (connector) {
    await connector.authenticate((integration.config ?? {}) as Record<string, unknown>, plaintextSecret);
    const result = await connector.testConnection();
    if (!result.ok) {
      throw new ApiError(
        400,
        "CREDENTIAL_VERIFICATION_FAILED",
        result.message ?? "The replacement credential failed connection verification",
      );
    }
  }

  const encrypted = await encryptSecret(plaintextSecret);

  const { data: existing } = await supabase
    .from("integration_credentials")
    .select("integration_id")
    .eq("integration_id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("integration_credentials")
        .update({ auth_type: authType, encrypted_secret: encrypted, rotated_at: new Date().toISOString() })
        .eq("integration_id", integrationId)
        .eq("tenant_id", tenantId)
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
