import "server-only";

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { OutboundBlockedError, checkOutboundUrl, isBlockedAddress, outboundPolicyFromEnv, type OutboundPolicy } from "./outboundPolicy";

/**
 * INTEGRATION-P0-11 / spec S8 — the one way a connector reaches a
 * customer-supplied address. A drop-in for the few `fetch` features the
 * connectors use (method, headers, body; `ok`, `status`, `json()`), that:
 *
 * - checks the URL before connecting (outboundPolicy.ts);
 * - checks every address the host resolves to at connect time, so DNS
 *   that points a public-looking name at an internal address is refused,
 *   including on a rebind between check and connect;
 * - follows at most 3 redirects, checking each target the same way, and
 *   drops credentials when a redirect leaves the original origin;
 * - times out, and caps the response size.
 *
 * Errors name the host only, never the path, query or credentials.
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export type GuardedInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  policy?: OutboundPolicy;
};

export function guardedLookup(policy: OutboundPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, family: options.family }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = addresses as dns.LookupAddress[];
      const bad = list.find((a) => isBlockedAddress(a.address, policy));
      if (bad || list.length === 0) {
        return callback(new OutboundBlockedError(`${hostname} resolves to an address that is not allowed`), "", 4);
      }
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

function once(url: URL, init: GuardedInit, policy: OutboundPolicy): Promise<{ status: number; statusText: string; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: init.method ?? "GET",
        headers: { ...(init.headers ?? {}), ...(init.body !== undefined ? { "content-length": Buffer.byteLength(init.body).toString() } : {}) },
        lookup: guardedLookup(policy),
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let failed = false;
        res.on("data", (chunk: Buffer) => {
          if (failed) return;
          size += chunk.length;
          if (size > maxBytes) {
            // Reject now: the rest of the body (or its end) must not
            // resolve a truncated response.
            failed = true;
            const limit = maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / 1024 / 1024)} MB` : `${Math.round(maxBytes / 1024)} KB`;
            reject(new OutboundBlockedError(`The response from ${url.hostname} is larger than ${limit}`));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (!failed) resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", (err) => {
          if (!failed) reject(err);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`The request to ${url.hostname} timed out after ${Math.round(timeoutMs / 1000)} s`)));
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

const CREDENTIAL_HEADERS = ["authorization", "x-api-key", "cookie", "proxy-authorization"];

export async function guardedFetch(input: string | URL, init: GuardedInit = {}): Promise<Response> {
  const policy = init.policy ?? outboundPolicyFromEnv();
  let url = checkOutboundUrl(input, policy);
  const origin = url.origin;
  let current: GuardedInit = { ...init };
  for (let hop = 0; ; hop++) {
    const res = await once(url, current, policy);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new OutboundBlockedError(`Too many redirects from ${url.hostname}`);
      url = checkOutboundUrl(new URL(location, url), policy);
      const headers = { ...(current.headers ?? {}) };
      if (url.origin !== origin) for (const h of Object.keys(headers)) if (CREDENTIAL_HEADERS.includes(h.toLowerCase())) delete headers[h];
      const toGet = res.status === 303 || ((res.status === 301 || res.status === 302) && (current.method ?? "GET") !== "GET");
      current = { ...current, headers, ...(toGet ? { method: "GET", body: undefined } : {}) };
      continue;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, String(v));
    }
    const noBody = res.status === 204 || res.status === 304 || (current.method ?? "GET") === "HEAD";
    return new Response(noBody ? null : new Uint8Array(res.body), { status: res.status, statusText: res.statusText, headers });
  }
}
