// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { brandTitle, wonderIdBrand } from "./brand";
import manifest from "./brandAssets.generated.json";

/**
 * BRAND-001/002/006 automated checks (branding specification §76): the
 * assets the brand configuration names exist and match their recorded
 * sizes, the site icons exist, the CSS palette is the
 * configuration's palette, titles follow the convention, and no screen
 * hard-codes a brand colour.
 */
const root = join(__dirname, "..", "..");

describe("brand assets", () => {
  it("every configured asset exists and is the PNG size the manifest records", () => {
    for (const [path, a] of Object.entries(manifest)) {
      const file = join(root, "public", "brand", path);
      expect(existsSync(file), path).toBe(true);
      const png = readFileSync(file);
      // PNG signature, then the IHDR chunk's width and height.
      expect(png.subarray(1, 4).toString("ascii"), path).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([a.width, a.height]);
    }
  });

  it("the site icons exist, and the artwork comes from the supplied brand sheet", () => {
    for (const p of ["app/favicon.ico", "app/icon.png", "app/apple-icon.png", "docs/requirements/wonderid-brand-sheet.png", "scripts/brand/extract-assets.py"]) {
      expect(existsSync(join(root, p)), p).toBe(true);
    }
    for (const a of Object.values(wonderIdBrand.assets)) expect(a.src.startsWith("/brand/")).toBe(true);
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
