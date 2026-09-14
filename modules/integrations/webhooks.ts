import "server-only";

import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { getDecryptedCredential } from "./credentials";

/**
 * INTEGRATION-P0-04.3. The webhook's shared secret is stored via the same
 * integration_credentials mechanism as connector credentials (auth_type
 * 'api_key'), per the backlog's explicit instruction for MCP event
 * ingestion, applied the same way here. This is a public, unauthenticated
 * (no user session) endpoint — the HMAC signature is the only trust
 * boundary, so every query here runs via the service-role client and
 * explicitly re-derives which tenant owns the integration rather than
 * trusting anything the caller sent.
 */

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Pure signature check, exported for unit testing without a live database —
 * the actual HTTP/DB flow in receiveWebhook() below is proven separately
 * against the live dev Supabase project (see tests/integration/).
 */
export function verifyHmacSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqualStrings(expected, signatureHeader);
}

export type WebhookResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404; reason: string };

/**
 * Verifies an HMAC-SHA256 signature (hex-encoded) over the exact raw request
 * body using the integration's stored shared secret, then persists the
 * payload as an integration_objects row (object_type 'activity' — a raw,
 * pre-normalization webhook payload doesn't yet know which of the six typed
 * object_type values it represents; normalization happens once the
 * receiving connector type-specific handler processes it, a P1 concern).
 * A request with a missing/invalid signature is rejected and never
 * persisted, per INTEGRATION-P0-04.3's acceptance criteria.
 */
export async function receiveWebhook(
  integrationId: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookResult> {
  if (!signatureHeader) {
    return { ok: false, status: 401, reason: "Missing signature" };
  }

  const supabase = supabaseServiceRole();
  const { data: integration, error } = await supabase
    .from("integrations")
    .select("id, tenant_id")
    .eq("id", integrationId)
    .maybeSingle();
  if (error || !integration) {
    return { ok: false, status: 404, reason: "Integration not found" };
  }

  const secret = await getDecryptedCredential(integration.tenant_id, integration.id);
  if (!secret) {
    return { ok: false, status: 403, reason: "No webhook secret configured" };
  }

  if (!verifyHmacSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "Invalid signature" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 401, reason: "Body is not valid JSON" };
  }

  const externalId = String(parsed.id ?? parsed.eventId ?? randomUUID());
  const { error: insertError } = await supabase.from("integration_objects").upsert(
    {
      tenant_id: integration.tenant_id,
      integration_id: integration.id,
      object_type: "activity",
      external_id: externalId,
      raw: parsed,
      normalized: parsed,
    },
    { onConflict: "integration_id,object_type,external_id" },
  );
  if (insertError) {
    return { ok: false, status: 403, reason: insertError.message };
  }

  await writeAudit({
    tenantId: integration.tenant_id,
    actorType: "integration",
    action: "integration.webhook_received",
    objectType: "integration",
    objectId: integration.id,
    outcome: "success",
    metadata: { externalId },
  });

  return { ok: true };
}
