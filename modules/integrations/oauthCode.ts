import "server-only";

import { createHmac } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { getSecretEncryptionKey } from "@/lib/db/env";
import { decryptSecret, encryptSecret } from "@/lib/security/encryptSecret";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { getDecryptedCredential, storeObtainedTokens } from "./credentials";
import { createConnector } from "./registry";
import { openGateway } from "./gateway/gateway";
import { parseConnectorConfig } from "./framework/engine";
import {
  OAUTH_COOKIE,
  STATE_LIFETIME_SECONDS,
  cookiePathFor,
  newNonce,
  pkcePair,
  redirectUriFor,
  signState,
  verifyState,
  type OAuthOutcome,
} from "./oauthCodeRules";

/**
 * INTEGRATION-P0-21 — "Sign in with the provider" (OAuth 2.0
 * authorization code with PKCE) for a connection.
 *
 * 1. start: an administrator (integration.update) presses Connect; WonderID
 *    sends their browser to the provider's own sign-in page with a signed
 *    state and a PKCE challenge, and sets an httpOnly cookie, scoped to the
 *    connection's callback, holding the nonce and the PKCE verifier.
 * 2. callback: the provider sends the browser back to the connection's
 *    receiver (/api/connect/v1/<id>/oauth/callback, non-negotiable #20).
 *    The state must verify, be unexpired, name this connection, and match
 *    the cookie; the code is then traded for tokens through the
 *    connection's Connector Gateway session, and the tokens are stored
 *    encrypted with its credentials. Nothing is trusted from the query but
 *    the code itself.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stateKey(): Buffer {
  return createHmac("sha256", getSecretEncryptionKey()).update("wonderid-oauth-state-key").digest();
}

/** WonderID's own address: APP_BASE_URL when set, else the request's origin. */
function baseUrl(requestOrigin: string): string {
  return (process.env.APP_BASE_URL?.trim() || requestOrigin).replace(/\/+$/, "");
}

/** The address to register with the provider for this connection. */
export function connectorRedirectUri(connectionId: string, requestOrigin: string): string {
  return redirectUriFor(baseUrl(requestOrigin), connectionId);
}

type Row = { id: string; tenant_id: string; status: string; integration_type_id: string; config: Record<string, unknown> | null };

async function loadCodeConnection(tenantId: string, connectionId: string): Promise<Row> {
  if (!UUID_RE.test(connectionId)) throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  const { data, error } = await supabaseServiceRole()
    .from("integrations")
    .select("id, tenant_id, status, integration_type_id, config")
    .eq("id", connectionId)
    .eq("tenant_id", tenantId)
    .maybeSingle<Row>();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.tenant_id !== tenantId || data.integration_type_id !== "connector") throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  if (data.status === "disabled") throw new ApiError(409, "INTEGRATION_DISABLED", "Enable the connection first");
  let authType: string;
  try {
    authType = parseConnectorConfig(data.config ?? {}).def.auth.type;
  } catch {
    throw new ApiError(400, "DEFINITION_INVALID", "This connection's definition can no longer be read");
  }
  if (authType !== "oauth2_authorization_code") throw new ApiError(400, "NOT_SIGN_IN", "This connection does not sign in with the provider");
  return data;
}

export type StartedSignIn = { location: string; cookie: { name: string; value: string; path: string; maxAge: number; secure: boolean } };

/** Step 1. The caller has checked integration.update for `tenantId`. */
export async function startConnectorSignIn(tenantId: string, actorId: string, connectionId: string, requestOrigin: string): Promise<StartedSignIn> {
  const row = await loadCodeConnection(tenantId, connectionId);
  const secret = await getDecryptedCredential(tenantId, connectionId);
  if (!secret) throw new ApiError(400, "CREDENTIALS_REQUIRED", "Save the client secret first");
  const nonce = newNonce();
  const { verifier, challenge } = pkcePair();
  const state = signState({ c: connectionId, t: tenantId, u: actorId, n: nonce, e: Math.floor(Date.now() / 1000) + STATE_LIFETIME_SECONDS }, stateKey());
  const redirectUri = connectorRedirectUri(connectionId, requestOrigin);
  // Building the address makes no request; the session is opened only for the definition and its settings.
  const gateway = openGateway({ tenantId, integrationId: connectionId, status: row.status });
  let location: string;
  try {
    const connector = createConnector(row.integration_type_id, gateway);
    await connector.authenticate(row.config ?? {}, secret);
    location = await connector.authorizationUrl({ state, codeChallenge: challenge, redirectUri });
    await connector.close();
  } finally {
    await gateway.flush();
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "integration.oauth_started",
    objectType: "integration",
    objectId: connectionId,
    outcome: "success",
  });
  return {
    location,
    cookie: {
      name: OAUTH_COOKIE,
      value: await encryptSecret(JSON.stringify({ n: nonce, v: verifier, r: redirectUri })),
      path: cookiePathFor(connectionId),
      maxAge: STATE_LIFETIME_SECONDS,
      secure: baseUrl(requestOrigin).startsWith("https:"),
    },
  };
}

/** Where the browser goes after the callback: the connection's page, with the outcome. */
function pageFor(connectionId: string, outcome: OAuthOutcome): string {
  return UUID_RE.test(connectionId) ? `/integrations/${connectionId}?oauth=${outcome}` : `/integrations?oauth=${outcome}`;
}

/** Step 2. Never throws: every path ends on the connection's page with an outcome. */
export async function completeConnectorSignIn(connectionId: string, query: URLSearchParams, cookieValue: string | null): Promise<{ location: string; cookiePath: string }> {
  const cookiePath = cookiePathFor(UUID_RE.test(connectionId) ? connectionId : "x");
  const done = (outcome: OAuthOutcome) => ({ location: pageFor(connectionId, outcome), cookiePath });

  const state = verifyState(query.get("state"), stateKey());
  if (!state || state.c !== connectionId || !UUID_RE.test(connectionId)) return done("expired");
  // The cookie holds the nonce, the PKCE verifier and the exact redirect address the start used.
  let bound: { n?: unknown; v?: unknown; r?: unknown } = {};
  try {
    bound = cookieValue ? (JSON.parse(await decryptSecret(cookieValue)) as typeof bound) : {};
  } catch {
    bound = {};
  }
  if (bound.n !== state.n || typeof bound.v !== "string" || typeof bound.r !== "string") return done("expired");
  const verifier = bound.v;
  const redirectUri = bound.r;

  // From here the organization is the signed state's, and the connection must still be its own.
  const audit = (outcome: "success" | "failure", metadata: Record<string, unknown>) =>
    writeAudit({ tenantId: state.t, actorId: state.u, actorType: "user", action: "integration.oauth_connected", objectType: "integration", objectId: connectionId, outcome, metadata });

  const providerError = query.get("error");
  if (providerError) {
    await audit("failure", { reason: "provider_refused", error: providerError.replace(/[^a-z_]/gi, "").slice(0, 60) });
    return done("denied");
  }
  const code = query.get("code");
  if (!code || code.length > 4000) {
    await audit("failure", { reason: "no_code" });
    return done("failed");
  }

  let row: Row;
  let secret: string | null;
  try {
    row = await loadCodeConnection(state.t, connectionId);
    secret = await getDecryptedCredential(state.t, connectionId);
  } catch {
    await audit("failure", { reason: "connection_unavailable" });
    return done("failed");
  }
  if (!secret) {
    await audit("failure", { reason: "no_credentials" });
    return done("failed");
  }

  const gateway = openGateway({ tenantId: state.t, integrationId: connectionId, status: row.status });
  let tested: { ok: boolean };
  try {
    const connector = createConnector(row.integration_type_id, gateway);
    await connector.authenticate(row.config ?? {}, secret);
    await connector.exchangeAuthorizationCode(code, verifier, redirectUri);
    const tokens = connector.obtainedTokens();
    if (!tokens) throw new Error("No tokens");
    await storeObtainedTokens(state.t, connectionId, tokens, { actorId: state.u, action: "integration.oauth_connected" });
    // A real call with the new sign-in, so the page says whether it works.
    tested = await connector.testConnection();
    await connector.close();
    const later = connector.obtainedTokens();
    if (later) await storeObtainedTokens(state.t, connectionId, later);
  } catch (err) {
    await audit("failure", { reason: "exchange_failed", message: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
    return done("failed");
  } finally {
    await gateway.flush();
  }
  await supabaseServiceRole()
    .from("integrations")
    .update({ status: tested.ok ? "connected" : "error" })
    .eq("id", connectionId)
    .eq("tenant_id", state.t);
  return done(tested.ok ? "connected" : "test_failed");
}
