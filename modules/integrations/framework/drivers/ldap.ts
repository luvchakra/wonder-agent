import "server-only";

import { Client } from "ldapts";
import type { DriverFactory } from "../engine";
import { fillTemplate } from "../mapping";
import { resolveSafeHost } from "./net";

/**
 * The ldap driver: LDAPS only (validate.ts refuses ldap://), a simple bind
 * with the organization's read-only account, paged searches. Values filled
 * into a filter from a parent record are escaped (RFC 4515), so a group
 * name can never widen a search. A custom CA (settings.caCertificate, PEM)
 * is honoured for directories with an internal certificate authority.
 */

export function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\\*()\u0000]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function plain(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (Buffer.isBuffer(v)) out[k] = v.toString("base64");
    else if (Array.isArray(v)) out[k] = v.map((x) => (Buffer.isBuffer(x) ? x.toString("base64") : x));
    else out[k] = v;
  }
  return out;
}

export const ldapDriver: DriverFactory = async (def, settings, secrets) => {
  const urlKey = def.settings.find((s) => s.type === "url")!.key;
  const url = new URL(String(settings[urlKey]));
  const address = await resolveSafeHost(url.hostname);
  const servername = /^[\d.]+$|:/.test(url.hostname) ? undefined : url.hostname;
  const ca = typeof settings.caCertificate === "string" && settings.caCertificate.includes("BEGIN CERTIFICATE") ? settings.caCertificate : undefined;
  const client = new Client({
    url: `ldaps://${address.includes(":") ? `[${address}]` : address}:${url.port || 636}`,
    timeout: 20_000,
    connectTimeout: 10_000,
    tlsOptions: { servername, ca, rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  const auth = def.auth as Extract<typeof def.auth, { type: "ldap_simple" }>;
  const scope = { settings, secret: secrets };
  await client.bind(fillTemplate(auth.bindDn, scope), fillTemplate(auth.password, scope));

  async function search(spec: { base: string; filter: string; scope?: "base" | "one" | "sub"; attributes?: string[] }, tplScope: Record<string, unknown>, max: number) {
    const base = fillTemplate(spec.base, tplScope);
    const filter = fillTemplate(spec.filter, tplScope, { escape: escapeLdapFilterValue });
    const { searchEntries } = await client.search(base, {
      scope: spec.scope ?? "sub",
      filter,
      attributes: spec.attributes,
      paged: { pageSize: Math.min(500, max) },
      sizeLimit: max,
    });
    return searchEntries.slice(0, max).map((e) => plain(e as Record<string, unknown>));
  }

  return {
    async test() {
      if (!def.test?.search) throw new Error("This definition has no test search");
      await search({ ...def.test?.search, scope: def.test?.search.scope ?? "base" }, { settings }, 1);
    },
    async fetch(resource, tplScope, max) {
      if (!resource.search) throw new Error("This resource has no search");
      return search(resource.search, tplScope, max);
    },
    async close() {
      await client.unbind().catch(() => undefined);
    },
  };
};
