// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { assertionClaims, privateKeyFrom, signJwt, ASSERTION_LIFETIME_SECONDS } from "./jwt";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pemOf = (k: { privateKey: import("node:crypto").KeyObject }) => k.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const parts = (jwt: string) => {
  const [h, c, s] = jwt.split(".");
  return { header: JSON.parse(Buffer.from(h, "base64url").toString()), claims: JSON.parse(Buffer.from(c, "base64url").toString()), input: `${h}.${c}`, signature: Buffer.from(s, "base64url") };
};

describe("signed assertions (INTEGRATION-P0-21)", () => {
  it("signs RS256 and ES256 tokens the public key verifies", () => {
    const claims = assertionClaims({ issuer: "client-1", subject: "client-1", audience: "https://idp.example/token", now: new Date("2026-10-12T10:00:00Z") });
    const r = parts(signJwt(claims, privateKeyFrom(pemOf(rsa), "RS256"), "RS256", "key-1"));
    expect(r.header).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
    expect(verify("sha256", Buffer.from(r.input), rsa.publicKey, r.signature)).toBe(true);
    const e = parts(signJwt(claims, privateKeyFrom(pemOf(ec), "ES256"), "ES256"));
    expect(e.header).toEqual({ alg: "ES256", typ: "JWT" });
    expect(verify("sha256", Buffer.from(e.input), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, e.signature)).toBe(true);
    expect(r.claims).toMatchObject({ iss: "client-1", sub: "client-1", aud: "https://idp.example/token", iat: 1791799200, exp: 1791799200 + ASSERTION_LIFETIME_SECONDS });
    expect(r.claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a key that is not a private key, or the wrong type for the algorithm, without echoing it", () => {
    expect(() => privateKeyFrom("not a key", "RS256")).toThrow(/^The private key is not a PEM private key$/);
    expect(() => privateKeyFrom(pemOf(ec), "RS256")).toThrow(/RS256 needs an RSA private key/);
    expect(() => privateKeyFrom(pemOf(rsa), "ES256")).toThrow(/ES256 needs a P-256 EC private key/);
  });
});
