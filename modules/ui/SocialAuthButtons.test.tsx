// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/db/supabaseBrowser", () => ({
  supabaseBrowser: () => ({ auth: { signInWithOAuth } }),
}));

import { isOAuthProviderEnabled, NOT_AVAILABLE_HINT, providerNotEnabledMessage, SocialAuthButtons } from "./SocialAuthButtons";

function settingsResponse(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }) as Response);
}

const ALL_ON = { external: { google: true, azure: true, linkedin_oidc: true } };
const ALL_OFF = { external: { google: false, azure: false, linkedin_oidc: false } };

describe("SocialAuthButtons — Google, Microsoft and LinkedIn", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders one button per provider with the screen's verb", () => {
    render(<SocialAuthButtons verb="Sign up" />);
    for (const name of ["Google", "Microsoft", "LinkedIn"]) {
      expect(screen.getByRole("button", { name: `Sign up with ${name}` })).toBeVisible();
    }
  });

  it("reads each provider's flag from the public auth settings with the publishable key", async () => {
    const fetchImpl = settingsResponse({ external: { google: true, azure: false, linkedin_oidc: true } });
    expect(await isOAuthProviderEnabled("google", fetchImpl)).toBe(true);
    expect(await isOAuthProviderEnabled("azure", fetchImpl)).toBe(false);
    expect(await isOAuthProviderEnabled("linkedin_oidc", fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/settings",
      expect.objectContaining({ headers: { apikey: "sb_publishable_test" }, signal: expect.any(AbortSignal) }),
    );
  });

  it("treats an unreachable or malformed settings response as unknown, never as disabled", async () => {
    expect(await isOAuthProviderEnabled("azure", settingsResponse({}, false))).toBeNull();
    expect(await isOAuthProviderEnabled("azure", settingsResponse({ external: {} }))).toBeNull();
    expect(await isOAuthProviderEnabled("azure", vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
  });

  it.each([
    ["Google", "google"],
    ["Microsoft", "azure"],
    ["LinkedIn", "linkedin_oidc"],
  ] as const)("says %s is not enabled, and does not redirect, when it is off", async (name, provider) => {
    vi.stubGlobal("fetch", settingsResponse(ALL_OFF));
    // Status unknown when the page rendered: the click-time check still tells the truth.
    render(<SocialAuthButtons verb="Sign in" status={null} />);
    fireEvent.click(screen.getByRole("button", { name: `Sign in with ${name}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent(providerNotEnabledMessage(provider));
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: `Sign in with ${name}` })).toBeEnabled();
  });

  it("starts each provider's OAuth flow back to /auth/callback, asking Microsoft for the email scope", async () => {
    vi.stubGlobal("fetch", settingsResponse(ALL_ON));
    render(<SocialAuthButtons verb="Sign in" />);
    const redirectTo = `${window.location.origin}/auth/callback`;

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(signInWithOAuth).toHaveBeenLastCalledWith({ provider: "google", options: { redirectTo } });

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(2));
    expect(signInWithOAuth).toHaveBeenLastCalledWith({ provider: "azure", options: { redirectTo, scopes: "email" } });

    fireEvent.click(screen.getByRole("button", { name: "Sign in with LinkedIn" }));
    await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(3));
    expect(signInWithOAuth).toHaveBeenLastCalledWith({ provider: "linkedin_oidc", options: { redirectTo } });
  });

  it("shows a method that is not turned on as disabled, and the rest as usable (owner request, 2026-10-10)", async () => {
    render(<SocialAuthButtons verb="Sign in" status={{ google: true, azure: false, linkedin_oidc: false, sso: false }} />);
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
    for (const name of ["Microsoft", "LinkedIn"]) {
      const button = screen.getByRole("button", { name: `Sign in with ${name}, ${NOT_AVAILABLE_HINT.toLowerCase()}` });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("reads the status itself when the page did not give one", async () => {
    vi.stubGlobal("fetch", settingsResponse({ external: { google: true, azure: false, linkedin_oidc: true } }));
    render(<SocialAuthButtons verb="Sign up" />);
    expect(await screen.findByRole("button", { name: `Sign up with Microsoft, ${NOT_AVAILABLE_HINT.toLowerCase()}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign up with LinkedIn" })).toBeEnabled();
  });

  it("still lets Supabase decide when the settings check cannot be made", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    render(<SocialAuthButtons verb="Sign in" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with LinkedIn" }));
    await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
  });
});
