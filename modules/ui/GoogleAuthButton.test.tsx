// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/db/supabaseBrowser", () => ({
  supabaseBrowser: () => ({ auth: { signInWithOAuth } }),
}));

import { GOOGLE_NOT_ENABLED_MESSAGE, GoogleAuthButton, isGoogleProviderEnabled } from "./GoogleAuthButton";

function settingsResponse(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }) as Response);
}

describe("GoogleAuthButton — Google provider guard", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads external.google from the public auth settings with the publishable key", async () => {
    const fetchImpl = settingsResponse({ external: { google: true } });
    expect(await isGoogleProviderEnabled(fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/settings",
      expect.objectContaining({ headers: { apikey: "sb_publishable_test" }, signal: expect.any(AbortSignal) }),
    );
    expect(await isGoogleProviderEnabled(settingsResponse({ external: { google: false } }))).toBe(false);
  });

  it("treats an unreachable or malformed settings response as unknown, never as disabled", async () => {
    expect(await isGoogleProviderEnabled(settingsResponse({}, false))).toBeNull();
    expect(await isGoogleProviderEnabled(settingsResponse({ external: {} }))).toBeNull();
    expect(await isGoogleProviderEnabled(vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
  });

  it("shows a truthful message and does not redirect when Google is disabled", async () => {
    vi.stubGlobal("fetch", settingsResponse({ external: { google: false } }));
    render(<GoogleAuthButton label="Sign in with Google" />);
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(GOOGLE_NOT_ENABLED_MESSAGE);
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Sign in with Google/ })).toBeEnabled();
  });

  it("starts the OAuth flow back to /auth/callback when Google is enabled", async () => {
    vi.stubGlobal("fetch", settingsResponse({ external: { google: true } }));
    render(<GoogleAuthButton />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it("still lets Supabase decide when the settings check cannot be made", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    render(<GoogleAuthButton />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
  });
});
