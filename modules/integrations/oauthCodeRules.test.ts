import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cookiePathFor, pkcePair, redirectUriFor, signState, verifyState, type OAuthState } from "./oauthCodeRules";

describe("sign in with the provider: state and PKCE (INTEGRATION-P0-21)", () => {
  const key = Buffer.alloc(32, 7);
  const now = Date.now();
  const state: OAuthState = { c: "11111111-1111-1111-1111-111111111111", t: "tenant-a", u: "user-1", n: "nonce", e: Math.floor(now / 1000) + 600 };

  it("a signed state verifies with its key, and nothing else does", () => {
    const token = signState(state, key);
    expect(verifyState(token, key, now)).toEqual(state);
    expect(verifyState(token, Buffer.alloc(32, 8), now)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, t: "tenant-b" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, key, now)).toBeNull();
    expect(verifyState(`${body}.${sig}x`, key, now)).toBeNull();
    expect(verifyState(`${body}.${sig}.extra`, key, now)).toBeNull();
    expect(verifyState("", key, now)).toBeNull();
    expect(verifyState(null, key, now)).toBeNull();
  });

  it("a state expires", () => {
    const token = signState(state, key);
    expect(verifyState(token, key, (state.e + 1) * 1000)).toBeNull();
  });

  it("the PKCE challenge is the S256 of a fresh verifier", () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
  });

  it("the callback is the connection's receiver, and only it receives the cookie", () => {
    expect(redirectUriFor("https://id.example/", "abc")).toBe("https://id.example/api/connect/v1/abc/oauth/callback");
    expect(redirectUriFor("https://id.example", "abc").startsWith(`https://id.example${cookiePathFor("abc")}`)).toBe(true);
  });
});
