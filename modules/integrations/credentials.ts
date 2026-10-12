import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { encryptSecret, decryptSecret } from "@/lib/security/encryptSecret";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AuthType } from "@/lib/shared/types/integrations";
import { createConnector } from "./registry";
import { openGateway } from "./gateway/gateway";
import { OAUTH_TOKEN_KEYS } from "./framework/types";

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
    .select("id, integration_type_id, config, status")
    .eq("id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (integrationError) throw new ApiError(500, "QUERY_FAILED", integrationError.message);
  if (!integration) throw new ApiError(404, "INTEGRATION_NOT_FOUND");

  // The verification's requests pass the connection's Connector Gateway session.
  const gateway = openGateway({ tenantId, integrationId, status: integration.status });
  let connector;
  try {
    connector = createConnector(integration.integration_type_id, gateway);
  } catch {
    connector = null;
  }
  if (connector) {
    let result: { ok: boolean; message?: string };
    try {
      await connector.authenticate((integration.config ?? {}) as Record<string, unknown>, plaintextSecret);
      // INTEGRATION-P0-21: a sign-in-with-the-provider connection has nothing to test
      // until an administrator connects it; its credentials are saved untested.
      result = connector.awaitsAuthorization() ? { ok: true } : await connector.testConnection();
      await connector.close();
    } finally {
      await gateway.flush();
    }
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

/**
 * INTEGRATION-P0-21: stores tokens a connection obtained (authorization
 * code: the first tokens after an administrator connects, a refreshed
 * access token, a rotated refresh token) inside its encrypted credential,
 * beside the values the organization entered. Service role, so the
 * tenant is checked on every query. A changed refresh token is audited;
 * the plaintext never leaves this function.
 */
export async function storeObtainedTokens(tenantId: string, integrationId: string, tokens: Record<string, string>, actor: { actorId: string | null; action?: string } = { actorId: null }): Promise<void> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("encrypted_secret, tenant_id")
    .eq("integration_id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ encrypted_secret: string; tenant_id: string }>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId) throw new ApiError(404, "CREDENTIAL_NOT_FOUND", "Save the connection's credentials first");
  let stored: Record<string, string>;
  try {
    stored = JSON.parse(await decryptSecret(data.encrypted_secret)) as Record<string, string>;
  } catch {
    throw new ApiError(400, "CREDENTIAL_UNREADABLE", "The saved credentials cannot hold sign-in tokens; save them again");
  }
  const rotated = Boolean(tokens[OAUTH_TOKEN_KEYS.refresh]) && tokens[OAUTH_TOKEN_KEYS.refresh] !== stored[OAUTH_TOKEN_KEYS.refresh];
  const merged: Record<string, string> = { ...stored };
  for (const k of Object.values(OAUTH_TOKEN_KEYS)) if (tokens[k]) merged[k] = tokens[k];
  const { error: updateError } = await supabase
    .from("integration_credentials")
    .update({ encrypted_secret: await encryptSecret(JSON.stringify(merged)), ...(rotated ? { rotated_at: new Date().toISOString() } : {}) })
    .eq("integration_id", integrationId)
    .eq("tenant_id", tenantId);
  if (updateError) throw new ApiError(500, "UPDATE_FAILED", updateError.message);
  if (rotated || actor.action) {
    await writeAudit({
      tenantId,
      actorId: actor.actorId,
      actorType: actor.actorId ? "user" : "system",
      action: actor.action ?? "integration.oauth_refresh_rotated",
      objectType: "integration",
      objectId: integrationId,
      outcome: "success",
      metadata: { refreshTokenChanged: rotated }, // never a token
    });
  }
}

/**
 * After a run (sync, write, test): stores whatever tokens the connector
 * obtained. A provider that rotates refresh tokens has already retired the
 * old one, so a failure here is logged loudly; the next run then reports
 * that the connection must be connected again.
 */
export async function keepObtainedTokens(tenantId: string, integrationId: string, connector: object | null): Promise<void> {
  const c = connector as { obtainedTokens?: () => Record<string, string> | null } | null;
  const tokens = typeof c?.obtainedTokens === "function" ? c.obtainedTokens() : null;
  if (!tokens) return;
  try {
    await storeObtainedTokens(tenantId, integrationId, tokens);
  } catch (err) {
    console.error(JSON.stringify({ event: "integration.oauth_tokens_not_saved", tenantId, integrationId, error: err instanceof Error ? err.message : "unknown" }));
  }
}
