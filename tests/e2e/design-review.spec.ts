import { test, expect, type Page } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * EXPERIENCE-P0-15 — the mechanical half of
 * docs/design/UI-UX-DESIGN-RULES.md §32's design-review checklist, run
 * against every top-level customer route so a regression is caught by CI
 * rather than by someone noticing a screenshot looks wrong.
 *
 * It deliberately checks only what a machine can judge: layout that
 * overflows or clips, a theme that does not actually change, controls too
 * small to tap, headings that are missing or duplicated, and raw
 * serialized data leaking into the UI. Whether a screen *looks* right is
 * still a human call.
 */

const ROUTES = [
  "/",
  "/agents",
  "/agents/discovery",
  "/access",
  "/policies",
  "/runtime",
  "/risk",
  "/compliance/campaigns",
  "/audit",
  "/reports",
  "/integrations",
  "/settings",
  // Added in the 2026-09-25 responsive pass: sub-pages with their own
  // tables and forms, which the top-level sweep never visited.
  "/agents/duplicates",
  "/agents/identities",
  "/access/requests",
  "/access/data-sources",
  "/risk/rogue",
  "/risk/investigations",
  "/integrations/jobs",
  "/integrations/mcp",
  "/settings/roles",
  // WonderID identity directory (IDENTITY-P0-17).
  "/identities",
  "/identities/all",
  "/identities/external",
  "/identities/new",
  "/identities/attributes",
  // Identity sources (INTEGRATION-P0-08/09).
  "/integrations/sources",
  "/integrations/sources/new",
  "/integrations/correlations",
];

/** The widths §32 names, plus the two the shell switches layout at. */
const WIDTHS = [
  { name: "large desktop", width: 1680, height: 1000 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "small laptop", width: 1024, height: 768 },
  { name: "tablet", width: 834, height: 1100 },
  { name: "large phone", width: 430, height: 932 },
  { name: "phone", width: 390, height: 844 },
  { name: "small phone", width: 360, height: 780 },
];

/**
 * Settles the route enough to measure layout without waiting on
 * `networkidle`, which is slow enough across twelve routes to blow the
 * per-test budget on its own.
 */
async function settle(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(150);
}

/** Routes whose tables drop low-priority columns instead of scrolling. */
const FIT_TABLES = ["/", "/agents", "/agents/identities", "/identities/all", "/audit", "/settings/roles"];

/** Labelled table regions whose content is wider than the region itself. */
async function scrollingTables(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="region"]'))
      .filter((r) => r.getBoundingClientRect().width > 0 && r.scrollWidth > r.clientWidth + 1)
      .map((r) => `${r.getAttribute("aria-label")}: ${r.scrollWidth}px in ${r.clientWidth}px`),
  );
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Content wider than the viewport that is NOT inside a scrollable
 * ancestor — i.e. content that is actually clipped or unreachable. A wide
 * table inside a declared `overflow-x-auto` region is deliberate and is
 * not a finding here; whether such a table should instead collapse to
 * cards is a separate rule, checked below.
 */
async function clippedElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollsHorizontally = (el: Element) => {
      const overflowX = getComputedStyle(el).overflowX;
      return overflowX === "auto" || overflowX === "scroll";
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= vw + 2 || rect.height === 0) continue;
      let ancestor: Element | null = el.parentElement;
      let contained = false;
      while (ancestor && ancestor !== document.body) {
        if (scrollsHorizontally(ancestor)) { contained = true; break; }
        ancestor = ancestor.parentElement;
      }
      if (!contained) {
        out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> is ${Math.round(rect.width)}px wide and not inside a scroll region`);
      }
    }
    return out.slice(0, 5);
  });
}

test.describe("design review — layout holds at every width", () => {
  test.use({ storageState: authFile("adminOne") });

  for (const { name, width, height } of WIDTHS) {
    test(`no horizontal overflow at ${name} (${width}px)`, async ({ page }) => {
      // Seventeen routes plus an agent's detail page in one test — this is
      // a sweep, not a unit check.
      test.setTimeout(300_000);
      await page.setViewportSize({ width, height });
      const problems: string[] = [];

      // Agent 360 has a dynamic URL, so resolve it from the list first.
      await settle(page, "/agents");
      const agentHref = await page.locator('a[href^="/agents/"][href*="-"]').first().getAttribute("href");
      const routes = agentHref ? [...ROUTES, agentHref] : ROUTES;

      for (const route of routes) {
        await settle(page, route);

        const overflow = await horizontalOverflow(page);
        if (overflow > 1) problems.push(`${route}: page scrolls ${overflow}px horizontally`);

        for (const clipped of await clippedElements(page)) {
          problems.push(`${route}: ${clipped}`);
        }

        // Screens rebuilt with column priorities must fit their tables to
        // the card at tablet-and-up widths rather than scroll sideways.
        if (width >= 768 && FIT_TABLES.includes(route)) {
          for (const region of await scrollingTables(page)) problems.push(`${route}: table scrolls sideways (${region})`);
        }
      }

      expect(problems, `layout breaks at ${width}px:\n${problems.join("\n")}`).toEqual([]);
    });
  }
});

test.describe("design review — structure and theming", () => {
  test.use({ storageState: authFile("adminOne") });

  test("the navigation rail and the tab bar swap at lg, never both, never neither", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "Main" });
    const tabs = page.getByRole("navigation", { name: "Primary" });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(rail).toBeVisible();
    await expect(tabs).toBeHidden();

    await page.setViewportSize({ width: 834, height: 1100 });
    await expect(rail).toBeHidden();
    await expect(tabs).toBeVisible();
  });

  test("the sidebar is dark navy in both themes, beside a themed page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const readSurfaces = () =>
      page.evaluate(() => {
        // The tokens are OKLCH, so getComputedStyle hands back `lab(...)`,
        // not `rgb(...)`. Painting onto a canvas is the reliable way to
        // normalize any CSS colour to sRGB before judging its lightness —
        // parsing the string with a number regex silently misreads lab().
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx2d = canvas.getContext("2d")!;
        const lum = (colour: string) => {
          ctx2d.clearRect(0, 0, 1, 1);
          ctx2d.fillStyle = colour;
          ctx2d.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data;
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        };
        const rail = document.querySelector("aside");
        return {
          body: lum(getComputedStyle(document.body).backgroundColor),
          rail: rail ? lum(getComputedStyle(rail).backgroundColor) : null,
        };
      });

    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    const light = await readSurfaces();
    expect(light.body, "light mode page background should be light").toBeGreaterThan(0.7);
    // EXPERIENCE-P0-18 (WonderID, 2026-09-26): the sidebar is dark navy in
    // light mode too, as in the WonderID mockups.
    expect(light.rail, "the sidebar should be dark navy in light mode").toBeLessThan(0.3);

    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const dark = await readSurfaces();
    expect(dark.body, "dark mode page background should be dark").toBeLessThan(0.3);
    expect(dark.rail, "the sidebar should be dark navy in dark mode").toBeLessThan(0.3);
  });

  test("every screen has exactly one top-level heading", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems: string[] = [];

    for (const route of ROUTES) {
      await settle(page, route);
      const count = await page.locator("h1").count();
      if (count !== 1) problems.push(`${route}: ${count} <h1> elements`);
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("no serialized objects or placeholder values leak into visible text", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems: string[] = [];

    for (const route of ROUTES) {
      await settle(page, route);
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      for (const needle of ["[object Object]", "undefined", "NaN", '{"type":']) {
        if (text.includes(needle)) problems.push(`${route}: shows ${needle}`);
      }
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("tables collapse to labelled cards below md, never sideways scroll", async ({ page }) => {
    // UI-UX-DESIGN-RULES.md's table section: critical data must never
    // require horizontal scrolling. Every raw table in the product goes
    // through the shared TableContainer, so this checks the rule holds
    // wherever one actually renders — including the agent-scoped and
    // report routes, which are not in ROUTES above.
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/agents");
    const agentHref = await page
      .locator('a[href^="/agents/"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")).find((h) => /^\/agents\/[0-9a-f-]{36}$/.test(h ?? "")) ?? null);
    const agentId = agentHref?.split("/agents/")[1];

    const routes = [
      ...ROUTES,
      "/reports/agent-inventory",
      ...(agentId ? [`/runtime/agents/${agentId}`, `/access/agents/${agentId}`] : []),
    ];

    const problems: string[] = [];
    for (const route of routes) {
      await settle(page, route);
      const bad = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out: string[] = [];
        for (const table of Array.from(document.querySelectorAll("table"))) {
          // React/Next leave hidden, empty parse-context tables in the
          // body while streaming rows; they are not rendered UI.
          if (!table.querySelector("tbody tr")) continue;
          if (table.getBoundingClientRect().width > vw + 2) out.push(`a table is ${Math.round(table.getBoundingClientRect().width)}px wide`);
          for (const head of Array.from(table.querySelectorAll("thead"))) {
            if (getComputedStyle(head).display !== "none") out.push("a table head is still shown at phone width");
          }
        }
        return out;
      });
      for (const problem of bad) problems.push(`${route}: ${problem}`);
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("mobile tab targets are large enough to hit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const tabs = page.getByRole("navigation", { name: "Primary" });
    const targets = await tabs.locator("a, button").all();
    expect(targets.length, "the tab bar should expose five destinations").toBe(5);

    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box, "every tab needs a hit area").not.toBeNull();
      // 44px is the platform guidance; the bar is 4 across plus More, so
      // width is constrained — height is what must hold up.
      expect(box!.height, "tab hit area is too short to tap reliably").toBeGreaterThanOrEqual(40);
    }
  });
});
