import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * INTEGRATION-P0-21 — signing in with the provider (OAuth 2.0
 * authorization code with PKCE). Pure rules: the `state` that travels to
 * the provider and back, the PKCE pair, and the callback's outcome codes.
 * The key is passed in (the service derives it from the encryption key).
 *
 * `state` names the connection, its organization and the administrator who
 * started, plus a nonce that must match the httpOnly cookie set when they
 * started (so a callback only completes in the browser that began it), and
 * it expires after ten minutes. It is signed, so none of it can be changed.
 */

export const STATE_LIFETIME_SECONDS = 600;
export const OAUTH_COOKIE = "wonderid_oauth";

export type OAuthState = { c: string; t: string; u: string; n: string; e: number };

/** What the connection page says after a callback (?oauth=<code>). */
export const OAUTH_OUTCOMES = {
  connected: "Connected. WonderID now signs in to this system with the account you approved.",
  test_failed: "Connected, but the connection test failed. Check the settings, then test again.",
  denied: "The sign-in was cancelled or refused at the provider, so nothing changed.",
  expired: "The sign-in took too long or was started in another browser. Connect again.",
  needs_credentials: "Save the client secret first, then connect.",
  failed: "Connecting failed, so nothing changed. Check the client ID, secret and addresses, then connect again.",
} as const;
export type OAuthOutcome = keyof typeof OAUTH_OUTCOMES;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string, key: Buffer) => createHmac("sha256", key).update(`wonderid-oauth-state.${body}`).digest();

export function newNonce(): string {
  return b64(randomBytes(18));
}

export function signState(state: OAuthState, key: Buffer): string {
  const body = b64(JSON.stringify(state));
  return `${body}.${b64(mac(body, key))}`;
}

/** The state if its signature holds and it has not expired; null otherwise. */
export function verifyState(token: string | null, key: Buffer, now = Date.now()): OAuthState | null {
  if (!token || token.length > 2000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(body, key);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const s = parsed as Partial<OAuthState>;
  if (typeof s.c !== "string" || typeof s.t !== "string" || typeof s.u !== "string" || typeof s.n !== "string" || typeof s.e !== "number") return null;
  if (s.e * 1000 < now) return null;
  return s as OAuthState;
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64(randomBytes(32));
  return { verifier, challenge: b64(createHash("sha256").update(verifier).digest()) };
}

/** The address the provider sends the administrator back to: the connection's receiver. */
export function redirectUriFor(base: string, connectionId: string): string {
  return `${base.replace(/\/+$/, "")}/api/connect/v1/${connectionId}/oauth/callback`;
}

/** The cookie's path: only the connection's callback ever receives it. */
export function cookiePathFor(connectionId: string): string {
  return `/api/connect/v1/${connectionId}/oauth`;
}
