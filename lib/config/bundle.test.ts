import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportConfigBundle, readConfigBundle } from "./bundle";
import { DEFAULT_CONFIG } from "./registry";

const source = { organization: "acme-dev", environment: "dev" };

describe("PLATFORM-P0-13: configuration bundles", () => {
  beforeEach(() => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "current-key");
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("exports every setting, signed, and reads it back", () => {
    const bundle = exportConfigBundle({ ...DEFAULT_CONFIG, "access.dormantDays": 180 } as typeof DEFAULT_CONFIG, source, new Date("2026-10-17T08:00:00Z"))!;
    expect(bundle.settings["access.dormantDays"]).toBe(180);
    expect(Object.keys(bundle.settings).length).toBe(Object.keys(DEFAULT_CONFIG).length);
    const read = readConfigBundle(JSON.stringify(bundle));
    expect(read).toEqual({ ok: true, bundle });
  });

  it("refuses a file changed after export, whatever the key order", () => {
    const bundle = exportConfigBundle(DEFAULT_CONFIG, source)!;
    const reordered = JSON.parse(JSON.stringify(bundle));
    reordered.settings = Object.fromEntries(Object.entries(reordered.settings).reverse());
    expect(readConfigBundle(JSON.stringify(reordered)).ok).toBe(true);
    const edited = { ...bundle, settings: { ...bundle.settings, "access.dormantDays": 30 } };
    expect(readConfigBundle(JSON.stringify(edited))).toMatchObject({ ok: false, message: expect.stringMatching(/changed after it was exported/) });
    const moved = { ...bundle, source: { organization: "other", environment: null } };
    expect(readConfigBundle(JSON.stringify(moved)).ok).toBe(false);
  });

  it("still accepts a file signed with a retired key, and refuses another server's", () => {
    const old = exportConfigBundle(DEFAULT_CONFIG, source)!;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "new-key");
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "current-key");
    expect(readConfigBundle(JSON.stringify(old)).ok).toBe(true);
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "");
    expect(readConfigBundle(JSON.stringify(old)).ok).toBe(false);
  });

  it("signs and accepts nothing without a key", () => {
    const bundle = exportConfigBundle(DEFAULT_CONFIG, source)!;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    expect(exportConfigBundle(DEFAULT_CONFIG, source)).toBeNull();
    expect(readConfigBundle(JSON.stringify(bundle))).toMatchObject({ ok: false, message: expect.stringMatching(/cannot check/) });
  });

  it("refuses what is not a bundle", () => {
    expect(readConfigBundle("").ok).toBe(false);
    expect(readConfigBundle("not json").ok).toBe(false);
    expect(readConfigBundle(JSON.stringify({ format: "other" })).ok).toBe(false);
    expect(readConfigBundle(JSON.stringify({ format: "wonderid-config-bundle", version: 2 }))).toMatchObject({ ok: false, message: expect.stringMatching(/different version/) });
    expect(readConfigBundle(JSON.stringify({ format: "wonderid-config-bundle", version: 1, settings: [] }))).toMatchObject({ ok: false, message: expect.stringMatching(/incomplete/) });
    expect(readConfigBundle("x".repeat(70 * 1024)).ok).toBe(false);
  });
});
