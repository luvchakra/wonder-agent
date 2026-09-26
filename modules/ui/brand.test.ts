// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { brandTitle, wonderIdBrand } from "./brand";
import manifest from "./brandAssets.generated.json";

/**
 * BRAND-001/002/006 automated checks (branding specification §76): the
 * assets the brand configuration names exist and match their recorded
 * sizes, the favicon and site icons exist, the CSS palette is the
 * configuration's palette, titles follow the convention, and no screen
 * hard-codes a brand colour.
 */
const root = join(__dirname, "..", "..");

describe("brand assets", () => {
  it("every configured asset exists, is vector artwork, and matches its manifest size", () => {
    for (const [path, a] of Object.entries(manifest)) {
      const file = join(root, "public", "brand", path);
      expect(existsSync(file), path).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg, path).toContain(`viewBox="0 0 ${a.width} ${a.height}"`);
      // Vector paths only: no embedded raster, no font dependency.
      expect(svg, path).not.toMatch(/<image|<text|data:image/);
      expect(svg, path).toContain("<title>WonderID</title>");
    }
  });

  it("the favicons, site icons and social image exist", () => {
    for (const p of [
      "public/brand/favicon/favicon.svg",
      "public/brand/favicon/favicon-16.png",
      "public/brand/favicon/favicon-32.png",
      "public/brand/favicon/apple-touch-icon.png",
      "public/brand/social/wonderid-og.png",
      "app/favicon.ico",
      "app/icon.png",
      "app/apple-icon.png",
    ]) {
      expect(existsSync(join(root, p)), p).toBe(true);
    }
    expect(existsSync(join(root, "public", wonderIdBrand.assets.social))).toBe(true);
  });
});

describe("brand tokens", () => {
  it("app/globals.css declares the configuration's palette", () => {
    const css = readFileSync(join(root, "app", "globals.css"), "utf8");
    for (const [name, hex] of Object.entries(wonderIdBrand.colors)) {
      expect(css.toLowerCase(), name).toContain(`--brand-${name}: ${hex.toLowerCase()};`);
      expect(css, name).toContain(`--color-brand-${name}: var(--brand-${name});`);
    }
  });

  it("no component or page hard-codes a brand colour", () => {
    const brandHex = Object.values(wonderIdBrand.colors).map((h) => h.toLowerCase());
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(name) && !/brand(\.test)?\.ts$/.test(name) && !name.endsWith("globals.css")) {
          const text = readFileSync(p, "utf8").toLowerCase();
          for (const hex of brandHex) if (text.includes(hex)) offenders.push(`${p.slice(root.length + 1)} ${hex}`);
        }
      }
    };
    walk(join(root, "app"));
    walk(join(root, "modules"));
    expect(offenders).toEqual([]);
  });
});

describe("brandTitle", () => {
  it("follows the tab-title convention", () => {
    expect(brandTitle()).toBe("WonderID · AI Identity Security");
    expect(brandTitle("Agents")).toBe("WonderID · Agents");
    expect(brandTitle("Agents", "ACME")).toBe("ACME · Agents · WonderID");
    expect(brandTitle(null, "ACME")).toBe("ACME · WonderID");
  });
});
