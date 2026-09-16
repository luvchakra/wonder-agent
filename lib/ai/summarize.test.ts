// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("@/modules/platform-admin/service", () => ({
  resolveAiProviderKey: vi.fn(),
}));

import { summarize, AiNotConfiguredError } from "./summarize";
import * as summarizeModule from "./summarize";
import { resolveAiProviderKey } from "@/modules/platform-admin/service";

const mockResolveAiProviderKey = vi.mocked(resolveAiProviderKey);

describe("summarize — FOUNDATION-P0-16 / PLATFORM-P0-05.2", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockResolveAiProviderKey.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("throws AiNotConfiguredError rather than returning a fake/empty summary when no key resolves (neither BYOK nor platform default)", async () => {
    mockResolveAiProviderKey.mockResolvedValue(null);
    await expect(summarize("tenant-1", { kind: "finding", data: { id: "f1" } })).rejects.toThrow(
      AiNotConfiguredError,
    );
  });

  it("never resolves when not configured — a caller can rely on catch(), never on a falsy/empty success value", async () => {
    mockResolveAiProviderKey.mockResolvedValue(null);
    const result = await summarize("tenant-1", { kind: "evidence_bundle", data: {} }).catch((err) => err);
    expect(result).toBeInstanceOf(AiNotConfiguredError);
  });

  it("calls OpenAI with the tenant's BYOK key and returns its content as the summary", async () => {
    mockResolveAiProviderKey.mockResolvedValue({
      source: "byok",
      provider: "openai",
      apiKey: "sk-tenant-key",
      model: "gpt-4o-mini",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "  A concise summary.  " } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await summarize("tenant-1", { kind: "finding", data: { id: "f1" } });

    expect(result.summary).toBe("A concise summary.");
    expect(result.provider).toBe("openai");
    expect(result.kind).toBe("finding");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-tenant-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("falls back to the platform-wide key when the tenant has no BYOK key configured (resolveAiProviderKey already encodes that precedence)", async () => {
    mockResolveAiProviderKey.mockResolvedValue({
      source: "platform",
      provider: "openai",
      apiKey: "sk-platform-key",
      model: "gpt-4o-mini",
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Summary." } }] }),
    }) as unknown as typeof fetch;

    const result = await summarize("tenant-2", { kind: "certification_item", data: {} });
    expect(result.summary).toBe("Summary.");
  });

  it("throws (not AiNotConfiguredError) when OpenAI returns a non-OK response — a real failure is never disguised as 'not configured'", async () => {
    mockResolveAiProviderKey.mockResolvedValue({
      source: "platform",
      provider: "openai",
      apiKey: "sk-platform-key",
      model: "gpt-4o-mini",
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }) as unknown as typeof fetch;

    const err = await summarize("tenant-1", { kind: "finding", data: {} }).catch((e) => e);
    expect(err).not.toBeInstanceOf(AiNotConfiguredError);
    expect(String(err)).toMatch(/429/);
  });

  it("exposes no database client — this module cannot query anything itself (boundary enforced by absence, not by a runtime check)", () => {
    const source = fs.readFileSync(path.join(__dirname, "summarize.ts"), "utf-8");
    expect(source).not.toMatch(/supabaseServer|supabaseServiceRole|supabaseBrowser/);
  });

  it("exports only a function returning prose (AiSummaryResult.summary: string) — never a structured/parseable decision value", () => {
    expect(Object.keys(summarizeModule).sort()).toEqual(["AiNotConfiguredError", "summarize"]);
  });
});
