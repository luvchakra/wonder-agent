import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAuthProviderStatus, parseAuthSettings } from "./authProviderStatus";

describe("auth provider status", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads each social provider and SAML SSO from the public settings", () => {
    expect(parseAuthSettings({ external: { google: true, email: true, azure: false }, saml_enabled: false })).toEqual({
      google: true,
      azure: false,
      linkedin_oidc: false,
      sso: false,
    });
    expect(parseAuthSettings({ external: { linkedin_oidc: true }, saml_enabled: true })).toMatchObject({ linkedin_oidc: true, sso: true });
  });

  it("returns unknown (null), never 'disabled', when the answer is unusable", async () => {
    expect(parseAuthSettings(null)).toBeNull();
    expect(parseAuthSettings({})).toBeNull();
    expect(await fetchAuthProviderStatus(vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response))).toBeNull();
    expect(await fetchAuthProviderStatus(vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
  });

  it("asks Supabase Auth with the publishable key", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ external: { google: true } }) }) as Response);
    expect(await fetchAuthProviderStatus(fetchImpl, { next: { revalidate: 300 } })).toMatchObject({ google: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/settings",
      expect.objectContaining({ headers: { apikey: "sb_publishable_test" }, next: { revalidate: 300 } }),
    );
  });
});
