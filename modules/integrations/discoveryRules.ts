import { ApiError } from "@/lib/shared/types/foundation";

/**
 * INTEGRATION-P0-10 — application discovery, pure (#9): reading an
 * application out of a connector's imported object, an OpenAPI document or
 * SCIM service-provider metadata; matching it to the catalog; and what a
 * new sighting changes. Documents are external content: they are parsed as
 * data and never followed (§17.2) — no URL in them is fetched here.
 */

const fail = (message: string): never => {
  throw new ApiError(400, "VALIDATION_FAILED", message);
};

export const DISCOVERY_STATUSES = ["UNRECOGNIZED", "MATCHED", "REGISTERED", "EXCEPTION", "IGNORED"] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];
export const DISCOVERY_SOURCE_KINDS = ["integration", "openapi", "scim", "manual"] as const;
export type DiscoverySourceKind = (typeof DISCOVERY_SOURCE_KINDS)[number];
/** The largest document accepted (CLAUDE.md §15). */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

export type DiscoveryCandidate = {
  source: DiscoverySourceKind;
  sourceKey: string;
  name: string;
  vendor: string | null;
  url: string | null;
  description: string | null;
  evidence: Record<string, unknown>;
};

export const normalizeKey = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** An https address, or null: anything else in a document is dropped, not stored. */
export function httpsUrl(v: unknown): string | null {
  const t = text(v, 500);
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

export function parseJsonDocument(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) fail(`${label}: paste the JSON document`);
  if (Buffer.byteLength(raw as string) > MAX_DOCUMENT_BYTES) fail(`${label}: the document is larger than 1 MB`);
  let doc: unknown;
  try {
    doc = JSON.parse(raw as string);
  } catch {
    fail(`${label}: not valid JSON (YAML is not read yet; convert it to JSON)`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(`${label}: expected a JSON object`);
  return doc as Record<string, unknown>;
}

/** An application from an OpenAPI 3 or Swagger 2 document. */
export function candidateFromOpenApi(doc: Record<string, unknown>): DiscoveryCandidate {
  const version = text(doc.openapi, 20) ?? text(doc.swagger, 20);
  if (!version) fail("document: not an OpenAPI or Swagger document (no openapi/swagger field)");
  const info = (doc.info && typeof doc.info === "object" ? doc.info : {}) as Record<string, unknown>;
  const name = text(info.title, 200) ?? fail("document: info.title is required");
  const servers = Array.isArray(doc.servers) ? (doc.servers as { url?: unknown }[]) : [];
  const swaggerHost = typeof doc.host === "string" ? `https://${doc.host}${typeof doc.basePath === "string" ? doc.basePath : ""}` : null;
  const url = servers.map((s) => httpsUrl(s?.url)).find(Boolean) ?? httpsUrl(swaggerHost);
  const components = (doc.components && typeof doc.components === "object" ? doc.components : {}) as Record<string, unknown>;
  const schemes = (components.securitySchemes ?? doc.securityDefinitions ?? {}) as Record<string, { type?: unknown }>;
  const contact = (info.contact && typeof info.contact === "object" ? info.contact : {}) as Record<string, unknown>;
  return {
    source: "openapi",
    sourceKey: normalizeKey(url ? `${name} ${url}` : name),
    name,
    vendor: text(contact.name, 200) ?? text(info["x-vendor"], 200),
    url,
    description: text(info.description, 2000),
    evidence: {
      specVersion: version,
      apiVersion: text(info.version, 50),
      paths: doc.paths && typeof doc.paths === "object" ? Object.keys(doc.paths).length : 0,
      securitySchemes: Object.entries(schemes)
        .slice(0, 20)
        .map(([k, v]) => ({ name: k.slice(0, 100), type: text(v?.type, 50) })),
    },
  };
}

const SCIM_SPC = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";

/** An application from SCIM 2.0 ServiceProviderConfig metadata, with the name and base address a person gives. */
export function candidateFromScim(input: { name: unknown; baseUrl: unknown; metadata: Record<string, unknown> }): DiscoveryCandidate {
  const name = text(input.name, 200) ?? fail("name: required");
  const url = httpsUrl(input.baseUrl) ?? fail("baseUrl: an https address");
  const m = input.metadata;
  const schemas = Array.isArray(m.schemas) ? m.schemas : [];
  if (!schemas.includes(SCIM_SPC)) fail(`metadata: not SCIM ServiceProviderConfig (schemas must include ${SCIM_SPC})`);
  const supported = (k: string) => Boolean(m[k] && typeof m[k] === "object" && (m[k] as { supported?: unknown }).supported === true);
  const auth = Array.isArray(m.authenticationSchemes) ? (m.authenticationSchemes as { type?: unknown; name?: unknown }[]) : [];
  return {
    source: "scim",
    sourceKey: normalizeKey(url),
    name,
    vendor: null,
    url,
    description: null,
    evidence: {
      patch: supported("patch"),
      bulk: supported("bulk"),
      filter: supported("filter"),
      changePassword: supported("changePassword"),
      authenticationSchemes: auth.slice(0, 10).map((a) => text(a?.type, 50) ?? text(a?.name, 100)).filter(Boolean),
      documentationUri: httpsUrl(m.documentationUri),
    },
  };
}

/** An application a connector imported (an `application` integration object). */
export function candidateFromIntegrationObject(o: { externalId: string; raw: Record<string, unknown>; normalized: Record<string, unknown> }): DiscoveryCandidate | null {
  const r = { ...o.raw, ...o.normalized };
  const name = text(r.displayName, 200) ?? text(r.name, 200) ?? text(r.applicationName, 200) ?? text(r.appName, 200);
  if (!name) return null;
  return {
    source: "integration",
    sourceKey: normalizeKey(o.externalId || name),
    name,
    vendor: text(r.vendor, 200) ?? text(r.publisher, 200),
    url: httpsUrl(r.url) ?? httpsUrl(r.homepage) ?? httpsUrl(r.loginUrl),
    description: text(r.description, 2000),
    evidence: { externalId: o.externalId.slice(0, 200), type: text(r.type, 50) ?? text(r.applicationType, 50) },
  };
}

export function candidateFromManual(input: { name: unknown; vendor?: unknown; url?: unknown; description?: unknown }): DiscoveryCandidate {
  const name = text(input.name, 200) ?? fail("name: required");
  if (input.url !== undefined && input.url !== null && input.url !== "" && !httpsUrl(input.url)) fail("url: an https address");
  const url = httpsUrl(input.url);
  return { source: "manual", sourceKey: normalizeKey(name), name, vendor: text(input.vendor, 200), url, description: text(input.description, 2000), evidence: {} };
}

export type CatalogEntry = { id: string; name: string; displayName: string | null; url: string | null };

const host = (u: string | null) => {
  if (!u) return null;
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Matches only on an authoritative identifier: the same name (or display
 * name) or the same https host as exactly one catalog application. A
 * looser resemblance is a suggestion for a person, never a match (§17.6).
 */
export function matchCatalog(c: Pick<DiscoveryCandidate, "name" | "url">, catalog: CatalogEntry[]): { applicationId: string | null; suggestedApplicationId: string | null } {
  const key = normalizeKey(c.name);
  const byName = catalog.filter((a) => normalizeKey(a.name) === key || (a.displayName && normalizeKey(a.displayName) === key));
  const h = host(c.url);
  const byHost = h ? catalog.filter((a) => host(a.url) === h) : [];
  const exact = [...new Map([...byName, ...byHost].map((a) => [a.id, a])).values()];
  if (exact.length === 1) return { applicationId: exact[0].id, suggestedApplicationId: null };
  if (exact.length > 1) return { applicationId: null, suggestedApplicationId: null };
  // Near: one name contains the other, both at least four characters (so
  // "SAP" never suggests "Sapphire").
  const near = catalog.filter((a) =>
    [a.name, a.displayName].filter((x): x is string => Boolean(x)).some((x) => {
      const n = normalizeKey(x);
      return key.length >= 4 && n.length >= 4 && (n.includes(key) || key.includes(n));
    }),
  );
  return { applicationId: null, suggestedApplicationId: near.length === 1 ? near[0].id : null };
}

/** Which decisions a discovery in a given state accepts. */
export function allowedDecisions(status: DiscoveryStatus): ("register" | "link" | "exception" | "ignore" | "reopen")[] {
  switch (status) {
    case "UNRECOGNIZED":
      return ["register", "link", "exception", "ignore"];
    case "EXCEPTION":
    case "IGNORED":
      return ["reopen"];
    default:
      return [];
  }
}
