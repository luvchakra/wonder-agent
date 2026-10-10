// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildManifest, requestOrigin } from "./manifest";

/** EXPERIENCE-P0-26 — the web app manifest has what installing needs. */
const root = join(__dirname, "..", "..", "..");

function pngSize(file: string): [number, number] {
  const png = readFileSync(file);
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("web app manifest", () => {
  const m = buildManifest("https://id.wonderapps.biz");

  it("names the app and opens it standalone at the home page", () => {
    expect(m.name).toBe("WonderID");
    expect(m.short_name).toBe("WonderID");
    expect(m.description).toBeTruthy();
    expect(m).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("has 192 and 512 icons and a maskable 512, each a real PNG of that size", () => {
    const icons = m.icons ?? [];
    const find = (sizes: string, purpose: string) => icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    for (const [sizes, purpose] of [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]] as const) {
      const icon = find(sizes, purpose);
      expect(icon, `${sizes} ${purpose}`).toBeDefined();
      expect(icon!.type).toBe("image/png");
      const file = join(root, "public", icon!.src);
      expect(existsSync(file), icon!.src).toBe(true);
      const n = Number(sizes.split("x")[0]);
      expect(pngSize(file)).toEqual([n, n]);
    }
    // The Apple touch icon Next serves from app/apple-icon.png.
    expect(pngSize(join(root, "app", "apple-icon.png"))).toEqual([180, 180]);
  });

  it("lists itself in related_applications by absolute URL, and does not prefer a store app", () => {
    expect(m.related_applications).toEqual([{ platform: "webapp", url: "https://id.wonderapps.biz/manifest.webmanifest" }]);
    expect(m.prefer_related_applications).not.toBe(true);
  });

  it("omits the self-reference when the request origin is unknown", () => {
    expect(buildManifest(null).related_applications).toBeUndefined();
  });
});

describe("requestOrigin", () => {
  it("builds the origin from the host and forwarded protocol", () => {
    expect(requestOrigin("id.wonderapps.biz", "https")).toBe("https://id.wonderapps.biz");
    expect(requestOrigin("acme.id.wonderapps.biz", "https,http")).toBe("https://acme.id.wonderapps.biz");
    expect(requestOrigin("localhost:3000", null)).toBe("http://localhost:3000");
    expect(requestOrigin("id.wonderapps.biz", null)).toBe("https://id.wonderapps.biz");
  });

  it("refuses a host that is not a plain hostname", () => {
    for (const h of [null, "", "evil.com/path", "a b", "x\"y", "host:abc", "-bad.example"]) expect(requestOrigin(h, "https"), String(h)).toBeNull();
  });
});
