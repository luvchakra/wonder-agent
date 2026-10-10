import type { ConnectorAdapter, ConnectorConfig, ImportedRecord } from "../connector";
import type {
  ConnectorCapabilities,
  NormalizedAccessGrant,
  NormalizedAccount,
  NormalizedApplication,
  NormalizedEntitlement,
  NormalizedIdentity,
} from "@/lib/shared/types/integrations";
import { RESOURCE_KINDS, type ConnectorDefinition, type ConnectorIntegrationConfig, type ResourceKind, type ResourceSpec } from "./types";
import { fillTemplate, mapRecord, matchesFilters, readPath, type TemplateScope } from "./mapping";
import { validateDefinition, validateSettings } from "./validate";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { ConnectorRequestError, HttpSession, LIMITS, type FetchLike } from "./http";

/**
 * DefinitionConnector: the single ConnectorAdapter that runs any connector
 * definition, built-in or custom. It plugs into the existing pipeline
 * unchanged: syncJobs.ts calls importIdentities()/importAccounts()/… and
 * stores each `{externalId, raw, normalized}` in integration_objects, where
 * identity sources, account reconciliation and application discovery read
 * them. `normalized` is filled here from the definition's field mappings,
 * so these integrations need no integration_mappings rows.
 */

/** A protocol driver: how records are fetched. Mapping is the engine's job. */
export interface ConnectorDriverSession {
  test(): Promise<void>;
  fetch(resource: ResourceSpec, scope: TemplateScope, maxRecords: number): Promise<unknown[]>;
  close?(): Promise<void>;
}

export type DriverFactory = (def: ConnectorDefinition, settings: Record<string, string | number | boolean>, secrets: Record<string, string>) => Promise<ConnectorDriverSession>;

export function httpDriver(fetchImpl: FetchLike): DriverFactory {
  return async (def, settings, secrets) => {
    const session = new HttpSession(def, settings, secrets, fetchImpl);
    return {
      async test() {
        if (!def.test?.request) throw new Error("This definition has no test request");
        await session.send(def.test?.request, { settings });
      },
      fetch(resource, scope, maxRecords) {
        if (!resource.request) throw new Error("This resource has no request");
        return session.fetchAll(resource.request, resource.records, resource.pagination, scope, maxRecords, resource.recordsKeyed);
      },
    };
  };
}

export type DriverFactories = Partial<Record<ConnectorDefinition["driver"], DriverFactory>>;

type Row = { record: unknown; parent?: unknown; spec: ResourceSpec };

/** A resource may be one request or several whose records are combined (groups and roles). */
/** The kinds a definition reads, in import order (an MCP server before its tools). */
export function kindsOf(def: ConnectorDefinition): ResourceKind[] {
  return RESOURCE_KINDS.filter((k) => specsOf(def, k).length > 0);
}

export function specsOf(def: ConnectorDefinition, kind: ResourceKind): ResourceSpec[] {
  const r = def.resources[kind];
  return r === undefined ? [] : Array.isArray(r) ? r : [r];
}

export function capabilitiesOf(def: ConnectorDefinition): ConnectorCapabilities {
  const r = def.resources;
  return {
    importIdentities: Boolean(r.identity),
    importAccounts: Boolean(r.account),
    importEntitlements: Boolean(r.entitlement),
    importAccess: Boolean(r.access_grant),
    importApplications: Boolean(r.application),
    importPolicies: Boolean(r.policy),
    // MCP declarations and received runtime events are both activity sources.
    importActivity: Boolean(r.mcp_server || r.mcp_tool || r.mcp_resource || def.receive?.runtimeEvents),
    provision: false,
    deprovision: false,
  };
}

/** The driver a stored connection uses, without validating it (its copy, or the built-in it names). */
export function connectionDriver(config: ConnectorConfig): string | null {
  const c = config as Partial<ConnectorIntegrationConfig>;
  if (c.manifest && typeof c.manifest === "object") return (c.manifest as { driver?: string }).driver ?? null;
  return BUILTIN_DEFINITIONS.find((d) => d.key === c.definition?.key && d.version === c.definition?.version)?.driver ?? null;
}

/** Reads and re-validates what an integration of type `connector` stores. */
export function parseConnectorConfig(config: ConnectorConfig): { def: ConnectorDefinition; settings: Record<string, string | number | boolean> } {
  const c = config as Partial<ConnectorIntegrationConfig>;
  // A connection made from a built-in may name it instead of carrying a copy:
  // exactly that key and version, from code, or nothing.
  const named = c.definition?.origin === "builtin" && !c.manifest ? BUILTIN_DEFINITIONS.find((d) => d.key === c.definition?.key && d.version === c.definition?.version) : undefined;
  const { definition, issues } = validateDefinition(c.manifest ?? named);
  if (!definition) throw new Error(`This integration's connector definition is invalid: ${issues[0]?.path} ${issues[0]?.message}`);
  const { settings, issues: settingIssues } = validateSettings(definition, c.settings);
  if (settingIssues.length) throw new Error(settingIssues[0].message);
  return { def: definition, settings };
}

export class DefinitionConnector implements ConnectorAdapter {
  capabilities: ConnectorCapabilities = {};
  private def!: ConnectorDefinition;
  private settings: Record<string, string | number | boolean> = {};
  private session: ConnectorDriverSession | null = null;
  private secrets: Record<string, string> = {};
  /** Raw records already fetched this run, so forEach children reuse their parents. */
  private rawCache = new Map<ResourceKind, Row[]>();
  private issues: { objectType: string; message: string }[] = [];

  constructor(private readonly drivers: DriverFactories) {}

  async authenticate(config: ConnectorConfig, secret: string | null): Promise<void> {
    const { def, settings } = parseConnectorConfig(config);
    this.def = def;
    this.settings = settings;
    this.capabilities = capabilitiesOf(def);
    this.secrets = {};
    if (def.auth.type !== "none") {
      const fields = def.auth.fields;
      let parsed: unknown = null;
      try {
        parsed = secret ? JSON.parse(secret) : null;
      } catch {
        // A credential saved before this connector existed is one plain string;
        // it still fits a connector that has exactly one secret field (a token).
        parsed = secret && fields.length === 1 ? { [fields[0].key]: secret } : null;
      }
      if (!parsed || typeof parsed !== "object") {
        if (!fields.every((f) => f.optional)) throw new Error("This connection has no credentials yet");
        parsed = {};
      }
      this.secrets = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    }
    this.session = null;
    this.rawCache.clear();
    this.issues = [];
  }

  private async open(): Promise<ConnectorDriverSession> {
    if (this.session) return this.session;
    const factory = this.drivers[this.def.driver];
    if (!factory) throw new Error(`The ${this.def.driver} driver is not available`);
    this.session = await factory(this.def, this.settings, this.secrets);
    return this.session;
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    // A receive-only connector calls nothing; its senders prove it works.
    if (this.def.driver === "none") return { ok: true, message: "Receives only" };
    try {
      await (await this.open()).test();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  healthCheck() {
    return this.testConnection();
  }

  /** The kinds this connection's definition reads, in import order. */
  kinds(): ResourceKind[] {
    return kindsOf(this.def);
  }

  /** Records that could not be mapped this run, for the sync job's error list. */
  drainIssues(): { objectType: string; message: string }[] {
    const out = this.issues;
    this.issues = [];
    return out;
  }

  private async rawRecords(kind: ResourceKind): Promise<Row[]> {
    const cached = this.rawCache.get(kind);
    if (cached) return cached;
    const all: Row[] = [];
    for (const spec of specsOf(this.def, kind)) all.push(...(await this.fetchSpec(spec)));
    this.rawCache.set(kind, all);
    return all;
  }

  /** One driver fetch; for an `optional` request a 404 is no records rather than a failure. */
  private async fetchOptional(session: ConnectorDriverSession, spec: ResourceSpec, scope: TemplateScope, max: number): Promise<unknown[]> {
    try {
      return await session.fetch(spec, scope, max);
    } catch (err) {
      if (spec.optional && err instanceof ConnectorRequestError && err.status === 404) return [];
      throw err;
    }
  }

  private async fetchSpec(spec: ResourceSpec): Promise<Row[]> {
    const session = await this.open();
    const max = spec.maxRecords ?? LIMITS.defaultMaxRecords;
    const rows: Row[] = [];
    if (spec.forEach) {
      const only = spec.forEachRequest === undefined ? null : specsOf(this.def, spec.forEach)[spec.forEachRequest];
      for (const { record: parent, spec: from } of await this.rawRecords(spec.forEach)) {
        if (only && from !== only) continue;
        if (rows.length >= max) break;
        const children = await this.fetchOptional(session, spec, { settings: this.settings, parent }, max - rows.length);
        for (const record of children) rows.push({ record, parent, spec });
      }
    } else if (spec.unwind) {
      for (const parent of await this.fetchOptional(session, spec, { settings: this.settings }, max)) {
        const items = readPath(parent, spec.unwind);
        for (const item of Array.isArray(items) ? items : items === undefined || items === null ? [] : [items]) {
          if (rows.length >= max) break;
          rows.push({ record: item && typeof item === "object" ? item : { value: item }, parent, spec });
        }
      }
    } else {
      for (const record of await this.fetchOptional(session, spec, { settings: this.settings }, max)) rows.push({ record, spec });
    }
    return rows.filter((r) => matchesFilters(r.record, spec.where, r.parent));
  }

  /** Fetches and maps one resource; exported shape is what syncJobs stores. */
  async importKind(kind: ResourceKind): Promise<ImportedRecord<Record<string, unknown>>[]> {
    if (specsOf(this.def, kind).length === 0) return [];
    const rows = await this.rawRecords(kind);
    const application = fillTemplate(this.def.application ?? this.def.name, { settings: this.settings }, { allowMissing: true }) || this.def.name;
    const byId = new Map<string, ImportedRecord<Record<string, unknown>>>();
    let invalid = 0;
    for (const { record, parent, spec } of rows) {
      const mapped = mapRecord(kind, spec.fields, { record, parent, settings: this.settings }, { application });
      if ("invalid" in mapped) {
        if (++invalid <= 20) this.issues.push({ objectType: kind, message: mapped.invalid });
        continue;
      }
      const raw = (record && typeof record === "object" ? record : { value: record }) as Record<string, unknown>;
      byId.set(mapped.externalId, { externalId: mapped.externalId, raw: parent ? { ...raw, _parent: parent } : raw, normalized: mapped.normalized });
    }
    if (invalid > 20) this.issues.push({ objectType: kind, message: `${invalid - 20} more ${kind} records could not be mapped` });
    return [...byId.values()];
  }

  importIdentities() {
    return this.importKind("identity") as unknown as Promise<ImportedRecord<NormalizedIdentity>[]>;
  }
  importAccounts() {
    return this.importKind("account") as unknown as Promise<ImportedRecord<NormalizedAccount>[]>;
  }
  importEntitlements() {
    return this.importKind("entitlement") as unknown as Promise<ImportedRecord<NormalizedEntitlement>[]>;
  }
  importAccess() {
    return this.importKind("access_grant") as unknown as Promise<ImportedRecord<NormalizedAccessGrant>[]>;
  }
  importApplications() {
    return this.importKind("application") as unknown as Promise<ImportedRecord<NormalizedApplication>[]>;
  }

  async close() {
    await this.session?.close?.();
    this.session = null;
  }
}
