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
  // Connection types (two-level Integrations, 2026-10-10).
  "/integrations/types",
  "/integrations/types/builtin/keycloak",
  "/settings/roles",
  // WonderID identity directory (IDENTITY-P0-17).
  "/identities",
  "/identities/all",
  "/identities/external",
  "/identities/new",
  "/identities/attributes",
  "/identities/lifecycle",
  "/access/applications/new",
  // Identity sources (INTEGRATION-P0-08/09).
  "/integrations/sources",
  "/integrations/sources/new",
  "/integrations/correlations",
  // Account inventory (ACCESS-P0-17) and application discovery (INTEGRATION-P0-10).
  "/access/accounts",
  "/integrations/discovery",
  // Request catalog and request policies (ACCESS-P0-18).
  "/access/catalog",
  "/access/request-policies",
  // Access packages (ACCESS-P0-20).
  "/access/packages",
  "/access/packages/new",
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

/** At phone width, tables wider than the screen or still showing their header row. */
async function uncollapsedTables(page: Page): Promise<string[]> {
  return page.evaluate(() => {
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

  // Each route is loaded once and measured at every width by resizing the
  // window, instead of loaded again for each width: 8 times fewer page
  // loads, and the same checks. Loading each route at every width took most
  // of a nightly half's 35 minutes (the 2026-10-14 nightly timed out).
  // The one-heading, leaked-value and phone-table checks, which each loaded
  // every route again, run in the same pass at the widths they used (1440
  // and 390). The routes are swept in four parts, so a slow part fails on
  // its own.
  const PARTS = 4;
  const size = Math.ceil(ROUTES.length / PARTS);
  for (let part = 0; part < PARTS; part++) {
    const partRoutes = ROUTES.slice(part * size, (part + 1) * size);
    test(`every route at every width: no overflow, one heading, no leaked values, tables collapse on phones, part ${part + 1}`, async ({ page }) => {
      // A sweep of many routes in one test, not a unit check.
      test.setTimeout(300_000);
      const problems: string[] = [];

      // Agent 360 and the agent-scoped pages have dynamic URLs, so part 1
      // resolves one agent from the list; it also takes the report route,
      // which is not in ROUTES.
      let routes = partRoutes;
      // Only the phone-table check applies to these (an access graph's
      // canvas is wider than a phone on purpose; it pans).
      const tablesOnly: string[] = [];
      if (part === 0) {
        await settle(page, "/agents");
        const agentHref = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/agents/"]'))
            .map((a) => a.getAttribute("href") ?? "")
            .find((h) => /^\/agents\/(\d+|[0-9a-f-]{36})$/.test(h)),
        );
        const agentId = agentHref?.split("/agents/")[1];
        if (agentHref) routes = [...partRoutes, agentHref];
        tablesOnly.push("/reports/agent-inventory", ...(agentId ? [`/runtime/agents/${agentId}`, `/access/agents/${agentId}`] : []));
      }

      for (const route of [...routes, ...tablesOnly]) {
        const onlyTables = tablesOnly.includes(route);
        await page.setViewportSize({ width: WIDTHS[0].width, height: WIDTHS[0].height });
        await settle(page, route);
        for (const { width, height } of WIDTHS) {
          if (onlyTables && width !== 390) continue;
          await page.setViewportSize({ width, height });
          // Let the layout and any resize observers catch up.
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          await page.waitForTimeout(100);

          if (!onlyTables) {
            const overflow = await horizontalOverflow(page);
            if (overflow > 1) problems.push(`${route} at ${width}px: page scrolls ${overflow}px horizontally`);
            for (const clipped of await clippedElements(page)) problems.push(`${route} at ${width}px: ${clipped}`);
          }

          // Screens rebuilt with column priorities must fit their tables to
          // the card at tablet-and-up widths rather than scroll sideways.
          if (width >= 768 && FIT_TABLES.includes(route)) {
            for (const region of await scrollingTables(page)) problems.push(`${route} at ${width}px: table scrolls sideways (${region})`);
          }

          // At desktop width: exactly one top-level heading, and no
          // serialized objects or placeholder values in the visible text.
          if (width === 1440 && ROUTES.includes(route)) {
            const h1s = await page.locator("h1").count();
            if (h1s !== 1) problems.push(`${route}: ${h1s} <h1> elements`);
            const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
            for (const needle of ["[object Object]", "undefined", "NaN", '{"type":']) {
              if (text.includes(needle)) problems.push(`${route}: shows ${needle}`);
            }
          }

          // At phone width (UI-UX-DESIGN-RULES.md's table section): critical
          // data never needs sideways scrolling, so every table collapses to
          // labelled cards.
          if (width === 390) {
            for (const problem of await uncollapsedTables(page)) problems.push(`${route} at 390px: ${problem}`);
          }
        }
      }

      expect(problems, `layout breaks:\n${problems.join("\n")}`).toEqual([]);
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

  test("the sidebar follows the theme: a light console rail in light mode, dark in dark mode", async ({ page }) => {
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
    // EXPERIENCE-P0-23 (2026-09-26, user decision): the branding
    // specification's light enterprise console — a white rail, superseding
    // EXPERIENCE-P0-18's navy one.
    expect(light.rail, "the sidebar should be light in light mode").toBeGreaterThan(0.9);

    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const dark = await readSurfaces();
    expect(dark.body, "dark mode page background should be dark").toBeLessThan(0.3);
    expect(dark.rail, "the sidebar should be dark in dark mode").toBeLessThan(0.3);
  });

  test("mobile tab targets are large enough to hit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const tabs = page.getByRole("navigation", { name: "Primary" });
    const targets = await tabs.locator("a, button").all();
    expect(targets.length, "only the floating More button (owner request 2026-10-14)").toBe(1);

    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box, "every tab needs a hit area").not.toBeNull();
      // 44px is the platform guidance; height is what must hold up.
      expect(box!.height, "tab hit area is too short to tap reliably").toBeGreaterThanOrEqual(40);
    }
  });
});
