// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { guardedFetch, guardedLookup } from "./outboundFetch";

/**
 * INTEGRATION-P0-11 — the guarded fetch against real local sockets: the
 * strict policy refuses loopback; the development switch reaches it; a
 * redirect is re-checked and cannot reach metadata; credentials do not
 * follow a redirect to another origin; big responses and slow servers
 * are cut off.
 */

let base = "";
let otherBase = "";
const seenAuth: (string | undefined)[] = [];
const seenKey: (string | string[] | undefined)[] = [];
const servers: http.Server[] = [];

function listen(handler: http.RequestListener): Promise<string> {
  const s = http.createServer(handler);
  servers.push(s);
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
}

beforeAll(async () => {
  otherBase = await listen((req, res) => {
    seenAuth.push(req.headers.authorization);
    seenKey.push(req.headers["x-acme-key"]);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ where: "other" }));
  });
  base = await listen((req, res) => {
    if (req.url === "/ok") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ ok: true, method: req.method }));
    }
    if (req.url === "/to-metadata") {
      res.statusCode = 302;
      res.setHeader("location", "http://169.254.169.254/latest/meta-data/");
      return res.end();
    }
    if (req.url === "/to-other") {
      res.statusCode = 307;
      res.setHeader("location", `${otherBase}/landing`);
      return res.end();
    }
    if (req.url === "/loop") {
      res.statusCode = 302;
      res.setHeader("location", "/loop");
      return res.end();
    }
    if (req.url === "/big") return res.end(Buffer.alloc(2048, 97));
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 2000);
    res.statusCode = 404;
    res.end();
  });
});

afterAll(() => servers.forEach((s) => s.close()));

const dev = { allowPrivateNetworks: true };
const strict = { allowPrivateNetworks: false };

describe("guardedFetch", () => {
  it("refuses loopback under the strict policy before connecting", async () => {
    await expect(guardedFetch(`${base}/ok`, { policy: strict })).rejects.toThrow(/https|not a public address/);
  });

  it("reaches a local server when the platform allows private networks", async () => {
    const res = await guardedFetch(`${base}/ok`, { method: "POST", body: "{}", policy: dev });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true, method: "POST" });
  });

  it("re-checks redirects: metadata is refused, loops stop", async () => {
    await expect(guardedFetch(`${base}/to-metadata`, { policy: dev })).rejects.toThrow(/metadata/);
    await expect(guardedFetch(`${base}/loop`, { policy: dev })).rejects.toThrow(/Too many redirects/);
  });

  it("drops credentials when a redirect leaves the origin", async () => {
    const res = await guardedFetch(`${base}/to-other`, { headers: { Authorization: "Bearer secret" }, policy: dev });
    expect(await res.json()).toEqual({ where: "other" });
    expect(seenAuth.at(-1)).toBeUndefined();
  });

  it("WID-H05: drops a connection's custom credential header on a redirect to another origin", async () => {
    await guardedFetch(`${base}/to-other`, { headers: { "X-Acme-Key": "k-secret" }, credentialHeaders: ["X-Acme-Key"], policy: dev });
    expect(seenKey.at(-1)).toBeUndefined();
  });

  it("WID-H05: refuses a 307 to another origin that would resend the request body", async () => {
    const before = seenAuth.length;
    await expect(guardedFetch(`${base}/to-other`, { method: "POST", body: '{"api_key":"k-secret"}', policy: dev })).rejects.toThrow(/would resend the request body/);
    expect(seenAuth.length).toBe(before);
  });

  it("caps the response size and times out slow servers", async () => {
    await expect(guardedFetch(`${base}/big`, { policy: dev, maxBytes: 1024 })).rejects.toThrow(/larger than/);
    await expect(guardedFetch(`${base}/slow`, { policy: dev, timeoutMs: 200 })).rejects.toThrow(/timed out/);
  });

  it("checks what a hostname resolves to at connect time (DNS rebinding)", async () => {
    // "localhost" resolves to loopback: the connect-time hook refuses it
    // under the strict policy and accepts it under the development switch.
    const run = (policy: { allowPrivateNetworks: boolean }) =>
      new Promise<string>((resolve, reject) =>
        guardedLookup(policy)("localhost", { family: 0 } as never, (err: Error | null, address: string | { address: string }[]) => (err ? reject(err) : resolve(String(address)))),
      );
    await expect(run(strict)).rejects.toThrow(/not allowed/);
    await expect(run(dev)).resolves.toMatch(/^(127\.|::1)/);
  });

  it("WID-H05: a name that turns private between lookups is refused at the connect that would reach it", async () => {
    // A rebinding name: public on the first lookup, loopback on the next.
    const answers = [[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]];
    const spy = vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => cb(null, answers.shift() ?? [])) as never);
    const resolve = () =>
      new Promise<string>((ok, fail) => guardedLookup(strict)("rebind.example", { family: 0 } as never, (err: Error | null, address: string | { address: string }[]) => (err ? fail(err) : ok(String(address)))));
    try {
      await expect(resolve()).resolves.toBe("93.184.216.34");
      await expect(resolve()).rejects.toThrow(/not allowed/);
    } finally {
      spy.mockRestore();
    }
  });

  it("WID-H05: a name resolving to a public and a private address is refused, whichever comes first", async () => {
    const spy = vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "2002:a00:1::1", family: 6 },
      ])) as never);
    try {
      await expect(
        new Promise<string>((ok, fail) => guardedLookup(strict)("mixed.example", { family: 0 } as never, (err: Error | null, address: string | { address: string }[]) => (err ? fail(err) : ok(String(address))))),
      ).rejects.toThrow(/not allowed/);
    } finally {
      spy.mockRestore();
    }
  });
});
