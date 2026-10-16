// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS, WHATS_NEW } from "./content";

/**
 * Fails when the help guide links to a route or anchor that no longer
 * exists (owner request, 2026-10-16). Routes come from the app's own
 * `page.tsx` files, so a renamed or removed screen breaks this test in the
 * same pull request.
 */
const APP_DIR = join(process.cwd(), "app");

function pageRoutes(dir: string): RegExp[] {
  const out: RegExp[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageRoutes(full));
    else if (name === "page.tsx") {
      const segments = relative(APP_DIR, dir)
        .split(sep)
        .filter((s) => s && !/^\(.*\)$/.test(s));
      const pattern = segments.map((s) => (/^\[.*\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
      out.push(new RegExp(`^/${pattern}$`));
    }
  }
  return out;
}

const ROUTES = pageRoutes(APP_DIR);
const IDS = new Set(GUIDE_SECTIONS.map((s) => s.id));
const routeExists = (path: string) => ROUTES.some((r) => r.test(path.split(/[?#]/)[0]));

describe("help guide links", () => {
  it("finds the app's pages (the check itself works)", () => {
    expect(routeExists("/settings/users")).toBe(true);
    expect(routeExists("/access/requests/123")).toBe(true);
    expect(routeExists("/no-such-screen")).toBe(false);
  });

  it("every 'Open in app' link is a page that exists", () => {
    for (const s of GUIDE_SECTIONS) if (s.href) expect(routeExists(s.href), `${s.id} → ${s.href}`).toBe(true);
  });

  it("every in-app path written in the guide's text is a page that exists", () => {
    for (const s of GUIDE_SECTIONS) {
      const text = [s.summary, ...s.body].join("\n");
      for (const m of text.matchAll(/(?<![\w.])\/(?:[a-z0-9-]+)(?:\/[a-z0-9-]+)*(?=[\s,.;:)'"`]|$)/g)) {
        expect(routeExists(m[0]), `${s.id} mentions ${m[0]}`).toBe(true);
      }
      for (const m of text.matchAll(/\/help#([a-z0-9-]+)/g)) expect(IDS.has(m[1]), `${s.id} → #${m[1]}`).toBe(true);
    }
  });

  it("every What's new item points at a section that exists", () => {
    for (const item of WHATS_NEW) expect(IDS.has(item.id), item.id).toBe(true);
  });
});
