import { createPrivateKey, randomUUID, sign, type KeyObject } from "node:crypto";
import type { JwtAlgorithm } from "./types";

/**
 * INTEGRATION-P0-21: signed JSON Web Tokens for connections that sign in
 * with a private key instead of a shared secret (RFC 7523): a client
 * assertion for OAuth client credentials (`private_key_jwt`) or the
 * assertion of the JWT-bearer grant (service accounts). The key is the
 * organization's secret; it is parsed here and never logged or returned.
 */

/** How long an assertion is valid: short, as RFC 7523 recommends. */
export const ASSERTION_LIFETIME_SECONDS = 300;

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** The private key, or a clear error that names no part of it. */
export function privateKeyFrom(pem: string, algorithm: JwtAlgorithm): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem.trim(), format: "pem" });
  } catch {
    throw new Error("The private key is not a PEM private key");
  }
  const type = key.asymmetricKeyType;
  if (algorithm === "RS256" && type !== "rsa") throw new Error("RS256 needs an RSA private key");
  if (algorithm === "ES256" && (type !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")) throw new Error("ES256 needs a P-256 EC private key");
  return key;
}

/** A compact JWS over `claims`, signed with `key`. */
export function signJwt(claims: Record<string, unknown>, key: KeyObject, algorithm: JwtAlgorithm, keyId?: string): string {
  const header = { alg: algorithm, typ: "JWT", ...(keyId ? { kid: keyId } : {}) };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature =
    algorithm === "RS256"
      ? sign("sha256", Buffer.from(input), key)
      : sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/** The claims of an assertion for `audience` (the token address), valid for five minutes. */
export function assertionClaims(input: { issuer: string; subject: string; audience: string; scope?: string; now?: Date }): Record<string, unknown> {
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return {
    iss: input.issuer,
    sub: input.subject,
    aud: input.audience,
    iat,
    exp: iat + ASSERTION_LIFETIME_SECONDS,
    jti: randomUUID(),
    ...(input.scope ? { scope: input.scope } : {}),
  };
}
