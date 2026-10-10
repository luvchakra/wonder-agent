import "server-only";

import { Client } from "pg";
import type { DriverFactory } from "../engine";
import { fillTemplate } from "../mapping";
import { resolveSafeHost } from "./net";

/**
 * The sql driver (PostgreSQL): TLS with certificate verification always
 * (a custom CA via settings.caCertificate), one read-only transaction per
 * query with a statement timeout, and a hard row limit. validate.ts has
 * already refused anything but a single SELECT/WITH with no templates.
 */
export const sqlDriver: DriverFactory = async (def, settings, secrets) => {
  const urlKey = def.settings.find((s) => s.type === "url")!.key;
  const url = new URL(String(settings[urlKey]));
  const address = await resolveSafeHost(url.hostname);
  const servername = /^[\d.]+$|:/.test(url.hostname) ? undefined : url.hostname;
  const ca = typeof settings.caCertificate === "string" && settings.caCertificate.includes("BEGIN CERTIFICATE") ? settings.caCertificate : undefined;
  const auth = def.auth as Extract<typeof def.auth, { type: "sql_password" }>;
  const scope = { settings, secret: secrets };
  const client = new Client({
    host: address,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    user: fillTemplate(auth.username, scope),
    password: fillTemplate(auth.password, scope),
    ssl: { rejectUnauthorized: true, servername, ca },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "WonderID",
  });
  await client.connect();

  async function readOnly(query: string, max: number): Promise<Record<string, unknown>[]> {
    const body = query.trim().replace(/;\s*$/, "");
    await client.query("BEGIN READ ONLY");
    try {
      const res = await client.query(`SELECT * FROM (${body}) AS wonderid_source LIMIT ${Math.max(1, Math.floor(max))}`);
      return res.rows as Record<string, unknown>[];
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
    }
  }

  return {
    async test() {
      if (!def.test.query) throw new Error("This definition has no test query");
      await readOnly(def.test.query, 1);
    },
    async fetch(resource, _scope, max) {
      if (!resource.query) throw new Error("This resource has no query");
      return readOnly(resource.query, max);
    },
    async close() {
      await client.end().catch(() => undefined);
    },
  };
};
