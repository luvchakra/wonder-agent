// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/security/encryptSecret", () => ({
  encryptSecret: vi.fn(async (s: string) => `enc(${s})`),
  decryptSecret: vi.fn(async (s: string) => s.replace(/^enc\(|\)$/g, "")),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: (event: unknown) => writeAudit(event) }));

const mockGetPlatformOpenAiApiKey = vi.fn();
const mockGetPlatformGeminiApiKey = vi.fn();
vi.mock("@/lib/db/env", () => ({
  getPlatformOpenAiApiKey: () => mockGetPlatformOpenAiApiKey(),
  getPlatformGeminiApiKey: () => mockGetPlatformGeminiApiKey(),
}));

let existingRow: {
  tenant_id: string;
  provider: string;
  use_own_key: boolean;
  encrypted_api_key: string | null;
  model: string;
} | null = null;

const updateFn = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
const insertFn = vi.fn(async () => ({ error: null }));

function makeQuery() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: existingRow, error: null }),
      }),
    }),
    update: updateFn,
    insert: insertFn,
  };
}

vi.mock("@/lib/db/supabaseServer", () => ({
  supabaseServiceRole: () => ({ from: () => makeQuery() }),
}));

import { setAiProviderConfig, resolveAiProviderKey } from "./aiProviderConfig";
import { ApiError } from "@/lib/shared/types/foundation";

beforeEach(() => {
  vi.clearAllMocks();
  existingRow = null;
});

describe("setAiProviderConfig — provider-scoped BYOK keys never carry across providers", () => {
  it("requires an API key when enabling BYOK for the first time", async () => {
    await expect(
      setAiProviderConfig("user-1", "tenant-1", { useOwnKey: true, provider: "openai" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(insertFn).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("persists a new OpenAI BYOK key on first configuration", async () => {
    await setAiProviderConfig("user-1", "tenant-1", { useOwnKey: true, provider: "openai", apiKey: "sk-abc" });
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", use_own_key: true, encrypted_api_key: "enc(sk-abc)" }),
    );
  });

  it("requires a fresh API key when switching provider, even though a key is already stored for the old provider", async () => {
    existingRow = { tenant_id: "tenant-1", provider: "openai", use_own_key: true, encrypted_api_key: "enc(sk-old)", model: "gpt-4o-mini" };

    await expect(
      setAiProviderConfig("user-1", "tenant-1", { useOwnKey: true, provider: "gemini" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("switches provider and stores the new key, never reusing the old provider's encrypted key", async () => {
    existingRow = { tenant_id: "tenant-1", provider: "openai", use_own_key: true, encrypted_api_key: "enc(sk-old)", model: "gpt-4o-mini" };

    await setAiProviderConfig("user-1", "tenant-1", { useOwnKey: true, provider: "gemini", apiKey: "AIza-new" });

    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "gemini", encrypted_api_key: "enc(AIza-new)", model: "gemini-2.0-flash" }),
    );
  });

  it("keeps the existing key when re-saving the same provider without a new key", async () => {
    existingRow = { tenant_id: "tenant-1", provider: "openai", use_own_key: true, encrypted_api_key: "enc(sk-keep)", model: "gpt-4o-mini" };

    await setAiProviderConfig("user-1", "tenant-1", { useOwnKey: true, provider: "openai", model: "gpt-4o" });

    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", encrypted_api_key: "enc(sk-keep)", model: "gpt-4o" }),
    );
  });
});

describe("resolveAiProviderKey — BYOK-first, else the same provider's platform default, else null", () => {
  it("returns the decrypted BYOK key for the tenant's configured provider", async () => {
    existingRow = { tenant_id: "tenant-1", provider: "gemini", use_own_key: true, encrypted_api_key: "enc(AIza-tenant)", model: "gemini-2.0-flash" };

    const resolved = await resolveAiProviderKey("tenant-1");
    expect(resolved).toEqual({ source: "byok", provider: "gemini", apiKey: "AIza-tenant", model: "gemini-2.0-flash" });
  });

  it("falls back to the platform-wide key for the configured provider, never the other provider's key", async () => {
    existingRow = { tenant_id: "tenant-1", provider: "gemini", use_own_key: false, encrypted_api_key: null, model: "gemini-2.0-flash" };
    mockGetPlatformGeminiApiKey.mockReturnValue("platform-gemini-key");
    mockGetPlatformOpenAiApiKey.mockReturnValue("platform-openai-key");

    const resolved = await resolveAiProviderKey("tenant-1");
    expect(resolved).toEqual({ source: "platform", provider: "gemini", apiKey: "platform-gemini-key", model: "gemini-2.0-flash" });
    expect(mockGetPlatformOpenAiApiKey).not.toHaveBeenCalled();
  });

  it("returns null when no config row exists and no OpenAI platform default is set (the implicit-openai default)", async () => {
    existingRow = null;
    mockGetPlatformOpenAiApiKey.mockReturnValue(null);

    const resolved = await resolveAiProviderKey("tenant-1");
    expect(resolved).toBeNull();
  });
});
