// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { guardedFetch } from "./outboundFetch";

/**
 * INTEGRATION-P0-21 — client certificates (mutual TLS) against a real
 * local TLS server that only lets in a client presenting the trusted
 * certificate. Throwaway certificates are made with openssl for this run
 * and deleted after; nothing is committed. The server's own certificate is
 * self-signed, so this file alone turns off server verification while it
 * runs.
 */

const dev = { allowPrivateNetworks: true };
let dir = "";
let base = "";
let otherBase = "";
const pem: Record<string, string> = {};
const servers: https.Server[] = [];
const seenOther: unknown[] = [];
const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

function selfSigned(name: string, cn: string) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${cn}`, "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.crt`)], { stdio: "ignore" });
  pem[`${name}Key`] = readFileSync(join(dir, `${name}.key`), "utf8");
  pem[`${name}Cert`] = readFileSync(join(dir, `${name}.crt`), "utf8");
}

function listen(options: https.ServerOptions, handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
  const s = https.createServer(options, handler);
  servers.push(s);
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve(`https://127.0.0.1:${(s.address() as AddressInfo).port}`)));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "wonderid-mtls-"));
  selfSigned("server", "127.0.0.1");
  selfSigned("client", "wonderid-connection");
  selfSigned("stranger", "someone-else");
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  otherBase = await listen({ key: pem.serverKey, cert: pem.serverCert, requestCert: true, rejectUnauthorized: false }, (req, res) => {
    seenOther.push((req.socket as TLSSocket).getPeerCertificate()?.subject?.CN);
    res.end("{}");
  });
  base = await listen({ key: pem.serverKey, cert: pem.serverCert, requestCert: true, rejectUnauthorized: true, ca: [pem.clientCert] }, (req, res) => {
    if (req.url === "/to-other") {
      res.statusCode = 307;
      res.setHeader("location", `${otherBase}/landing`);
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ cn: (req.socket as TLSSocket).getPeerCertificate().subject?.CN }));
  });
}, 30_000);

afterAll(() => {
  servers.forEach((s) => s.close());
  if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("client certificates (mutual TLS)", () => {
  it("presents the connection's certificate, and the server lets it in", async () => {
    const res = await guardedFetch(`${base}/whoami`, { policy: dev, clientCert: { cert: pem.clientCert, key: pem.clientKey } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cn: "wonderid-connection" });
  });

  it("without a certificate, or with one the server does not trust, the server refuses", async () => {
    await expect(guardedFetch(`${base}/whoami`, { policy: dev })).rejects.toThrow();
    await expect(guardedFetch(`${base}/whoami`, { policy: dev, clientCert: { cert: pem.strangerCert, key: pem.strangerKey } })).rejects.toThrow();
  });

  it("never presents the certificate to another origin a redirect points at", async () => {
    const res = await guardedFetch(`${base}/to-other`, { policy: dev, clientCert: { cert: pem.clientCert, key: pem.clientKey } });
    expect(res.status).toBe(200);
    expect(seenOther.at(-1)).toBeUndefined();
  });
});
