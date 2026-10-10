import "server-only";

import { supabaseServer } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { AuthType, Integration } from "@/lib/shared/types/integrations";
import { OutboundBlockedError, checkOutboundUrl, outboundPolicyFromEnv } from "../outboundPolicy";
import { createIntegration } from "../integrations";
import { setCredential } from "../credentials";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { capabilitiesOf, parseConnectorConfig } from "./engine";
import { createDefinitionConnector } from "./connector";
import { validateDefinition, validateSecrets, validateSettings } from "./validate";
import { RESOURCE_KINDS, type ConnectorDefinition, type ConnectorIntegrationConfig, type DefinitionIssue, type ResourceKind, type ResourceSpec } from "./types";

/**
 * The connector catalog: WonderID's built-in definitions plus an
 * organization's own (connector_definitions), and the operations on them.
 * Callers have already checked the permission (integration.read to list,
 * integration.create to add a definition or a connection, integration.update
 * for credentials); `tenantId` is the server-resolved context (§14).
 */

export type DefinitionOrigin = "builtin" | "custom";

export type DefinitionSummary = {
  key: string;
  version: string;
  origin: DefinitionOrigin;
  name: string;
  vendor: string | null;
  category: ConnectorDefinition["category"];
  driver: ConnectorDefinition["driver"];
  description: string;
  resources: ResourceKind[];
  /** What the connection's systems can send WonderID: runtimeEvents, webhook, gateway. */
  receives: string[];
  createdAt: string | null;
};

function summarize(def: ConnectorDefinition, origin: DefinitionOrigin, createdAt: string | null = null): DefinitionSummary {
  return {
    key: def.key,
    version: def.version,
    origin,
    name: def.name,
    vendor: def.vendor ?? null,
    category: def.category,
    driver: def.driver,
    description: def.description,
    resources: RESOURCE_KINDS.filter((k) => def.resources[k]),
    receives: Object.keys(def.receive ?? {}),
    createdAt,
  };
}

const builtinKeys = () => new Set(BUILTIN_DEFINITIONS.map((d) => d.key));

/** Built-in definitions, then this organization's (latest version of each key first). */
export async function listConnectorDefinitions(tenantId: string): Promise<DefinitionSummary[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("connector_definitions")
    .select("key, version, manifest, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  const latest = new Map<string, DefinitionSummary>();
  for (const row of data ?? []) {
    if (latest.has(row.key as string)) continue;
    const { definition } = validateDefinition(row.manifest);
    if (definition) latest.set(row.key as string, summarize(definition, "custom", row.created_at as string));
  }
  return [...BUILTIN_DEFINITIONS.map((d) => summarize(d, "builtin")), ...latest.values()];
}

export async function listCustomDefinitionVersions(tenantId: string, key: string): Promise<DefinitionSummary[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("connector_definitions")
    .select("manifest, created_at")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).flatMap((r) => {
    const { definition } = validateDefinition(r.manifest);
    return definition ? [summarize(definition, "custom", r.created_at as string)] : [];
  });
}

/** One definition: a built-in by key, or this organization's version (latest when none is named). */
export async function getConnectorDefinition(tenantId: string, origin: DefinitionOrigin, key: string, version?: string): Promise<ConnectorDefinition | null> {
  if (origin === "builtin") return BUILTIN_DEFINITIONS.find((d) => d.key === key && (!version || d.version === version)) ?? null;
  const supabase = await supabaseServer();
  let q = supabase.from("connector_definitions").select("manifest").eq("tenant_id", tenantId).eq("key", key);
  if (version) q = q.eq("version", version);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data) return null;
  return validateDefinition(data.manifest).definition;
}

export class DefinitionInvalidError extends ApiError {
  constructor(readonly issues: DefinitionIssue[]) {
    super(400, "DEFINITION_INVALID", issues.slice(0, 5).map((i) => `${i.path || "definition"}: ${i.message}`).join("; "));
  }
}

/** Publishes a version of this organization's own definition. Versions never change once saved. */
export async function saveCustomDefinition(tenantId: string, actorId: string, manifest: unknown): Promise<DefinitionSummary> {
  const { definition, issues } = validateDefinition(manifest);
  if (!definition) throw new DefinitionInvalidError(issues);
  if (builtinKeys().has(definition.key)) throw new ApiError(409, "KEY_RESERVED", `"${definition.key}" is a built-in connector; choose another key`);
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("connector_definitions")
    .insert({
      tenant_id: tenantId,
      key: definition.key,
      version: definition.version,
      name: definition.name,
      category: definition.category,
      driver: definition.driver,
      manifest: definition,
      created_by: actorId,
    })
    .select("created_at")
    .single();
  if (error?.code === "23505") throw new ApiError(409, "VERSION_EXISTS", `Version ${definition.version} of "${definition.key}" already exists; raise the version to publish a change`);
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "The definition could not be saved");
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "integration.connector_definition_published",
    objectType: "connector_definition",
    objectId: `${definition.key}@${definition.version}`,
    outcome: "success",
    metadata: { key: definition.key, version: definition.version, driver: definition.driver, resources: Object.keys(definition.resources) },
  });
  return summarize(definition, "custom", data.created_at as string);
}

/** Every address setting must pass the outbound guard before anything is stored. */
export function checkConnectorAddresses(def: ConnectorDefinition, settings: Record<string, unknown>) {
  const policy = outboundPolicyFromEnv();
  for (const s of def.settings) {
    if (s.type !== "url" || typeof settings[s.key] !== "string") continue;
    const u = new URL(String(settings[s.key]));
    const probe = u.protocol === "https:" || u.protocol === "http:" ? u.toString() : `https://${u.host}/`;
    try {
      checkOutboundUrl(probe, policy);
    } catch (err) {
      if (err instanceof OutboundBlockedError) throw new ApiError(400, "OUTBOUND_BLOCKED", `${s.label}: ${err.message}`);
      throw err;
    }
  }
}

const AUTH_TYPE_FOR: Record<ConnectorDefinition["auth"]["type"], AuthType> = {
  none: "api_key",
  basic: "basic",
  bearer: "bearer",
  header: "api_key",
  query: "api_key",
  oauth2_client_credentials: "oauth2",
  ldap_simple: "basic",
  sql_password: "basic",
};

export type ConnectInput = { origin: DefinitionOrigin; key: string; version?: string; name: string; settings: unknown; secret?: unknown };

/**
 * Connects an organization's system: validates its settings and addresses,
 * creates an integration of type `connector` holding a snapshot of the
 * definition, then saves and verifies the credentials (setCredential tests
 * the connection before storing anything). A failed connection test leaves
 * the integration without credentials and says why, rather than claiming
 * success (§17.5).
 */
export async function connectSystem(tenantId: string, actorId: string, input: ConnectInput): Promise<{ integration: Integration; credentialError: string | null }> {
  const def = await getConnectorDefinition(tenantId, input.origin, input.key, input.version);
  if (!def) throw new ApiError(404, "DEFINITION_NOT_FOUND", "No such connector");
  const { settings, issues } = validateSettings(def, input.settings);
  if (issues.length) throw new DefinitionInvalidError(issues);
  checkConnectorAddresses(def, settings);
  let secret: string | null = null;
  if (input.secret !== undefined && def.auth.type !== "none") {
    const s = validateSecrets(def, input.secret);
    if (s.issues.length) throw new DefinitionInvalidError(s.issues);
    secret = s.secret;
  }
  const urlKeys = def.settings.filter((s) => s.type === "url").map((s) => s.key);
  const baseUrl = settings[urlKeys.includes("baseUrl") ? "baseUrl" : urlKeys[0]];
  const config: ConnectorIntegrationConfig = {
    definition: { key: def.key, version: def.version, origin: input.origin },
    manifest: def,
    settings,
    ...(typeof baseUrl === "string" && /^https?:/.test(baseUrl) ? { baseUrl } : {}),
  };
  const integration = await createIntegration(tenantId, actorId, {
    integrationTypeId: "connector",
    name: input.name,
    config: config as unknown as Record<string, unknown>,
    capabilities: capabilitiesOf(def),
  });
  let credentialError: string | null = null;
  if (secret) {
    try {
      await setCredential(tenantId, actorId, integration.id, AUTH_TYPE_FOR[def.auth.type], secret);
      integration.hasCredentials = true;
    } catch (err) {
      credentialError = err instanceof Error ? err.message : "The connection test failed";
    }
  }
  return { integration, credentialError };
}

/** Saves (or rotates) a connector integration's credentials; the connection is tested first. */
export async function setConnectorCredentials(tenantId: string, actorId: string, integrationId: string, secretInput: unknown): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("integrations")
    .select("config, integration_type_id")
    .eq("id", integrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!data || data.integration_type_id !== "connector") throw new ApiError(404, "INTEGRATION_NOT_FOUND");
  const { def } = parseConnectorConfig(data.config ?? {});
  const { secret, issues } = validateSecrets(def, secretInput);
  if (issues.length || !secret) throw new DefinitionInvalidError(issues);
  await setCredential(tenantId, actorId, integrationId, AUTH_TYPE_FOR[def.auth.type], secret);
}

export type PreviewResult = {
  ok: boolean;
  message: string | null;
  resource: ResourceKind;
  count: number;
  records: Record<string, unknown>[];
  samples: Record<string, unknown>[];
  issues: { objectType: string; message: string }[];
};

/**
 * Runs one resource of a definition against a real system without saving
 * anything: how an integrator checks a definition before publishing it.
 * Same engine, same outbound guard, same limits as a sync. Audited, since
 * it calls out with the credentials entered.
 */
export async function previewConnector(
  tenantId: string,
  actorId: string,
  input: { manifest: unknown; settings: unknown; secret?: unknown; resource: string; limit?: number },
): Promise<PreviewResult> {
  const { definition: def, issues } = validateDefinition(input.manifest);
  if (!def) throw new DefinitionInvalidError(issues);
  const resource = input.resource as ResourceKind;
  if (!RESOURCE_KINDS.includes(resource) || !def.resources[resource]) throw new ApiError(400, "INVALID_INPUT", "resource: choose one this definition has");
  const { settings, issues: settingIssues } = validateSettings(def, input.settings);
  if (settingIssues.length) throw new DefinitionInvalidError(settingIssues);
  checkConnectorAddresses(def, settings);
  const { secret, issues: secretIssues } = validateSecrets(def, input.secret);
  if (secretIssues.length) throw new DefinitionInvalidError(secretIssues);

  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
  const cap = (r: ResourceSpec, k: string): ResourceSpec => ({ ...r, maxRecords: Math.min(r.maxRecords ?? 1000, k === resource ? 1000 : 200) });
  const capped = {
    ...def,
    resources: Object.fromEntries(Object.entries(def.resources).map(([k, r]) => [k, Array.isArray(r) ? r.map((x) => cap(x, k)) : r && cap(r, k)])),
  } as ConnectorDefinition;
  const connector = createDefinitionConnector();
  let result: PreviewResult;
  try {
    await connector.authenticate({ definition: { key: def.key, version: def.version, origin: "custom" }, manifest: capped, settings } as unknown as Record<string, unknown>, secret);
    const records = await connector.importKind(resource);
    result = {
      ok: true,
      message: null,
      resource,
      count: records.length,
      records: records.slice(0, limit).map((r) => r.normalized ?? {}),
      samples: records.slice(0, 3).map((r) => r.raw),
      issues: connector.drainIssues(),
    };
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : "The preview failed", resource, count: 0, records: [], samples: [], issues: connector.drainIssues() };
  } finally {
    await connector.close();
  }
  await writeAudit({
    tenantId,
    actorId,
    actorType: "user",
    action: "integration.connector_previewed",
    objectType: "connector_definition",
    objectId: `${def.key}@${def.version}`,
    outcome: result.ok ? "success" : "failure",
    metadata: { resource, count: result.count },
  });
  return result;
}
