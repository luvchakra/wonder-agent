import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { encryptSecret, decryptSecret } from "@/lib/security/encryptSecret";
import { writeAudit } from "@/lib/audit/writeAudit";
import { getPlatformOpenAiApiKey, getPlatformGeminiApiKey } from "@/lib/db/env";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AiProviderConfig, AiProviderName, ResolvedAiProviderKey } from "@/lib/shared/types/platform";

/**
 * PLATFORM-P0-05.2 — AI Provider Configuration. Resolved 2026-09-16: OpenAI
 * and (per a follow-up user request the same day) Gemini, both
 * platform-wide and per-tenant BYOK, tenant chooses via `use_own_key`.
 *
 * `platform_ai_provider_configs` grants no client-facing policy at all
 * (migration 0057) — every function here uses the service-role client and
 * therefore must verify tenant ownership itself (RLS isn't doing that job),
 * same discipline as modules/integrations/credentials.ts. The plaintext key
 * never appears in a return value, a log line, or is reachable from any API
 * response.
 */

const DEFAULT_MODEL_BY_PROVIDER: Record<AiProviderName, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

function getPlatformKeyForProvider(provider: AiProviderName): string | null {
  return provider === "gemini" ? getPlatformGeminiApiKey() : getPlatformOpenAiApiKey();
}

function toAiProviderConfig(row: {
  tenant_id: string;
  provider: string;
  use_own_key: boolean;
  model: string;
  updated_by: string;
  updated_at: string;
  created_at: string;
}): AiProviderConfig {
  return {
    tenantId: row.tenant_id,
    provider: row.provider as AiProviderConfig["provider"],
    useOwnKey: row.use_own_key,
    hasOwnKey: row.use_own_key,
    model: row.model,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/**
 * Returns null if the tenant has never configured anything — callers should
 * treat that as "use the OpenAI platform default, no BYOK key set" rather
 * than an error.
 */
export async function getAiProviderConfig(tenantId: string): Promise<AiProviderConfig | null> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("platform_ai_provider_configs")
    .select("tenant_id, provider, use_own_key, model, updated_by, updated_at, created_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  return toAiProviderConfig(data);
}

export type SetAiProviderConfigInput = {
  useOwnKey: boolean;
  /** Defaults to the tenant's existing provider, or "openai" if none is set yet. */
  provider?: AiProviderName;
  /** Only required when useOwnKey is true and no key is already stored for the (possibly new) provider; omit to keep the existing stored key. */
  apiKey?: string;
  model?: string;
};

export async function setAiProviderConfig(
  actorId: string,
  tenantId: string,
  input: SetAiProviderConfigInput,
): Promise<void> {
  const supabase = supabaseServiceRole();

  const { data: existing, error: existingError } = await supabase
    .from("platform_ai_provider_configs")
    .select("tenant_id, provider, encrypted_api_key, model")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existingError) throw new ApiError(500, "QUERY_FAILED", existingError.message);

  const provider: AiProviderName = input.provider ?? (existing?.provider as AiProviderName | undefined) ?? "openai";
  // A stored encrypted key is provider-specific (an OpenAI key is not a
  // valid Gemini key, and vice versa) — switching provider must never
  // silently carry the old provider's key forward as if it were the new
  // provider's.
  const providerChanged = Boolean(existing) && existing!.provider !== provider;

  if (input.useOwnKey && !input.apiKey && (providerChanged || !existing?.encrypted_api_key)) {
    throw new ApiError(400, "API_KEY_REQUIRED", "An API key is required to enable bring-your-own-key");
  }

  const encryptedApiKey = input.apiKey
    ? await encryptSecret(input.apiKey)
    : providerChanged
      ? null
      : (existing?.encrypted_api_key ?? null);

  const model = input.model ?? (providerChanged ? undefined : existing?.model) ?? DEFAULT_MODEL_BY_PROVIDER[provider];

  const row = {
    tenant_id: tenantId,
    provider,
    use_own_key: input.useOwnKey,
    encrypted_api_key: encryptedApiKey,
    model,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  };

  const { error } = existing
    ? await supabase.from("platform_ai_provider_configs").update(row).eq("tenant_id", tenantId)
    : await supabase.from("platform_ai_provider_configs").insert(row);
  if (error) throw new ApiError(500, "SAVE_FAILED", error.message);

  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: existing ? "ai_provider_config.updated" : "ai_provider_config.created",
    objectType: "ai_provider_config",
    objectId: tenantId,
    outcome: "success",
    metadata: { provider, useOwnKey: input.useOwnKey, model }, // never the key itself
  });
}

/**
 * The one function lib/ai/summarize.ts calls to resolve which key to use.
 * BYOK-first: if the tenant has `use_own_key` set and a stored key for its
 * configured provider, use it. Otherwise fall back to that same provider's
 * platform-wide default key (PLATFORM_OPENAI_API_KEY / PLATFORM_GEMINI_API_KEY)
 * — never a different provider than the one configured. Returns null when
 * neither is available — the caller renders that as "Connect an AI
 * provider" (AiNotConfiguredError), never a crash.
 */
export async function resolveAiProviderKey(tenantId: string): Promise<ResolvedAiProviderKey | null> {
  const supabase = supabaseServiceRole();
  const { data, error } = await supabase
    .from("platform_ai_provider_configs")
    .select("tenant_id, provider, use_own_key, encrypted_api_key, model")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);

  const provider: AiProviderName = (data?.provider as AiProviderName | undefined) ?? "openai";

  if (data?.use_own_key && data.encrypted_api_key) {
    return {
      source: "byok",
      provider,
      apiKey: await decryptSecret(data.encrypted_api_key),
      model: data.model,
    };
  }

  const platformKey = getPlatformKeyForProvider(provider);
  if (platformKey) {
    return {
      source: "platform",
      provider,
      apiKey: platformKey,
      model: data?.model ?? DEFAULT_MODEL_BY_PROVIDER[provider],
    };
  }

  return null;
}
