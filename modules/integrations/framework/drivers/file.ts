import type { ConnectorDriverSession, DriverContext, DriverFactory } from "../engine";
import { ConnectorRequestError } from "../http";
import { fillTemplate, type TemplateScope } from "../mapping";
import { MAX_CSV_BYTES, readCsvFile } from "../csv";
import type { ConnectorDefinition, ResourceKind, ResourceSpec } from "../types";

/**
 * The file driver: CSV files, one per canonical kind. A resource reads
 * either the HTTPS address its `file.url` names (fetched through the same
 * SSRF-guarded fetch as the http driver, with the definition's auth and a
 * 10 MB cap), or, when that is empty, the newest file sent to the
 * connection's `file` receiver (or imported from an object page) for its
 * kind. Every flow of a file into WonderID runs here (non-negotiable #20).
 *
 * Read only. Pure of any WonderID storage: the caller injects the fetch and
 * the store of uploaded files, so the unit tests use fakes.
 */

/** The guarded fetch, with its response-size cap. */
export type FileFetch = (url: string, init: { method?: string; headers?: Record<string, string>; maxBytes?: number }) => Promise<Response>;

export type StoredFile = { id: string; filename: string | null; content: string };

/** Uploaded files of one connection (connector_files), for one run. */
export interface ConnectorFileStore {
  /** The newest file received for `kind` that no sync has read yet, or null. */
  newest(kind: ResourceKind): Promise<StoredFile | null>;
  /** Marks that file, and any older unread file of its kind, as read. */
  markRead(kind: ResourceKind, file: StoredFile): Promise<void>;
}

export type FileStoreFactory = (context: DriverContext) => ConnectorFileStore;

/** The address a resource reads, or "" when it reads uploads. */
export function fileAddress(spec: ResourceSpec, settings: Record<string, unknown>): string {
  return spec.file?.url ? fillTemplate(spec.file.url, { settings }, { allowMissing: true }).trim() : "";
}

/** The column renames a resource reads from the connection's settings. */
export function fileColumns(spec: ResourceSpec, settings: Record<string, unknown>): string | undefined {
  return spec.file?.columns ? fillTemplate(spec.file.columns, { settings }, { allowMissing: true }) : undefined;
}

/** The request headers for the definition's auth (none, bearer, basic or header). */
export function fileAuthHeaders(def: ConnectorDefinition, settings: Record<string, unknown>, secrets: Record<string, string>): Record<string, string> {
  const scope: TemplateScope = { settings, secret: secrets };
  const auth = def.auth;
  switch (auth.type) {
    case "none":
      return {};
    case "bearer": {
      const token = fillTemplate(auth.token, scope, { allowMissing: true });
      return token ? { Authorization: `Bearer ${token}` } : {};
    }
    case "basic":
      return { Authorization: `Basic ${Buffer.from(`${fillTemplate(auth.username, scope)}:${fillTemplate(auth.password, scope)}`).toString("base64")}` };
    case "header":
      return { [fillTemplate(auth.name, scope)]: fillTemplate(auth.value, scope) };
    default:
      throw new ConnectorRequestError(`The file driver cannot use ${auth.type} authentication`);
  }
}

/** Reads one CSV address. Errors name the host and path, never the query (it may hold a credential). */
async function download(fetchImpl: FileFetch, address: string, headers: Record<string, string>): Promise<string> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new ConnectorRequestError("The file address is not a valid URL");
  }
  const label = `GET ${url.host}${url.pathname}`;
  const res = await fetchImpl(url.toString(), { method: "GET", headers: { Accept: "text/csv, text/plain, */*", ...headers }, maxBytes: MAX_CSV_BYTES });
  if (!res.ok) throw new ConnectorRequestError(`${label} failed: HTTP ${res.status}`, res.status);
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) throw new ConnectorRequestError(`${label}: the file is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB`);
  return text;
}

function parsed(kind: ResourceKind, spec: ResourceSpec, text: string, settings: Record<string, unknown>, source: string): Record<string, unknown>[] {
  const { records, issues } = readCsvFile(kind, spec, text, fileColumns(spec, settings));
  if (issues.length) {
    const i = issues[0];
    throw new ConnectorRequestError(`${source}: row ${i.row}${i.column ? `, ${i.column}` : ""}: ${i.message}`);
  }
  return records;
}

export function fileDriver(deps: { fetch: FileFetch; store?: FileStoreFactory }): DriverFactory {
  return async (def, settings, secrets, context): Promise<ConnectorDriverSession> => {
    const store = context && deps.store ? deps.store(context) : null;
    const read: { kind: ResourceKind; file: StoredFile }[] = [];
    return {
      /** Each address the connection reads answers with a CSV whose columns fit; a connection that only receives files has nothing to call. */
      async test() {
        for (const [kind, value] of Object.entries(def.resources) as [ResourceKind, ResourceSpec | ResourceSpec[]][]) {
          for (const spec of Array.isArray(value) ? value : [value]) {
            const address = fileAddress(spec, settings);
            if (address) parsed(kind, spec, await download(deps.fetch, address, fileAuthHeaders(def, settings, secrets)), settings, `The ${kind} file`);
          }
        }
      },
      async fetch(spec, _scope, maxRecords, kind) {
        const address = fileAddress(spec, settings);
        if (address) {
          return parsed(kind, spec, await download(deps.fetch, address, fileAuthHeaders(def, settings, secrets)), settings, `The ${kind} file`).slice(0, maxRecords);
        }
        // No address: the newest file received for this kind, if any. A
        // preview (no stored connection) has no received files.
        if (!store) return [];
        const file = await store.newest(kind);
        if (!file) return [];
        // Marked read even when it fails to parse: the job reports why, and
        // the next run waits for a corrected file instead of failing again.
        read.push({ kind, file });
        return parsed(kind, spec, file.content, settings, `The ${kind} file ${file.filename ?? file.id}`).slice(0, maxRecords);
      },
      /** Files read in this run are marked read, so the next run waits for a new one. */
      async close() {
        if (!store) return;
        for (const { kind, file } of read.splice(0)) await store.markRead(kind, file);
      },
    };
  };
}
