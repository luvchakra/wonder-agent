#!/usr/bin/env node
/**
 * WonderID brand assets (BRAND-001, EXPERIENCE-P0-22) — builds every file
 * under public/brand/ from one geometry, so the mark, lockups, favicons and
 * the social image can never drift apart.
 *
 *   node scripts/brand/build-assets.mjs            # SVGs
 *   node scripts/brand/build-assets.mjs --raster   # + PNG favicons, app icons, social image (Playwright's Chromium)
 *
 * INTERIM ARTWORK. No official vector files were supplied with the brand
 * specification (docs/requirements/WonderID_Branding_Application_Wide_Implementation_Requirements.md);
 * this redraws the brand sheet (docs/requirements/wonderid-brand-sheet.png):
 * a W whose centre forms a person — head above the central peak — in
 * Electric Blue, Sky Blue and Violet. When official SVGs arrive, drop them
 * in public/brand/logo/ under the same names and stop running this script.
 *
 * The wordmark is outlined, not live text: wordmark-outlines.json holds the
 * glyphs of Geist (SIL Open Font License 1.1, the app's own typeface) at
 * weight 700 for "WonderID" and 500 for the tagline, extracted once with
 * fontTools from the next/font latin subset:
 *   instantiateVariableFont(font, {wght: 700}) → SVGPathPen per glyph, y flipped.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = (p) => join(root, "public", "brand", p);

// Brand colours (specification §19). The sheet image prints #081220 and
// #2563FF for the first two; the specification's text is authoritative.
const C = {
  navy: "#08122C",
  blue: "#2538FF",
  sky: "#06B6DA",
  violet: "#8B5CF6",
  slate: "#94A3B8",
  mist: "#F1F5F9",
  // "ID" on dark backgrounds: Electric Blue lifted for contrast on navy (4.6:1).
  blueOnDark: "#5C74FF",
  white: "#FFFFFF",
};

// ------------------------------------------------------------------ mark
// viewBox 0 0 120 100. Two arms of the W, the person's body where they
// cross, and the head above the central peak.
const MARK_VIEWBOX = "0 0 120 100";
const LEFT = "M15 23 L39 83 L60 47";
const RIGHT = "M60 47 L81 83 L105 23";
const BODY = "M53 59 L60 47 L67 59";
const HEAD = { cx: 60, cy: 17, r: 12.5 };
const STROKE = 21;

function markShapes(mode, idp = "w") {
  if (mode !== "color") {
    const ink = mode === "mono-dark" ? C.navy : C.white;
    return {
      defs: "",
      body:
        `<g fill="none" stroke="${ink}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"><path d="${LEFT}"/><path d="${RIGHT}"/></g>` +
        `<circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r}" fill="${ink}"/>`,
    };
  }
  const defs =
    `<defs>` +
    `<linearGradient id="${idp}l" x1="15" y1="23" x2="45" y2="85" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3D63FF"/><stop offset="1" stop-color="${C.blue}"/></linearGradient>` +
    `<linearGradient id="${idp}r" x1="70" y1="85" x2="108" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.blue}"/><stop offset=".55" stop-color="#1F7BF2"/><stop offset="1" stop-color="${C.sky}"/></linearGradient>` +
    `<linearGradient id="${idp}b" x1="60" y1="70" x2="60" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1E22C9"/><stop offset="1" stop-color="#6A45F2"/></linearGradient>` +
    `<linearGradient id="${idp}h" x1="50" y1="6" x2="70" y2="30" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4A6BFF"/><stop offset="1" stop-color="${C.blue}"/></linearGradient>` +
    `</defs>`;
  const s = `fill="none" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
  return {
    defs,
    body:
      `<path d="${LEFT}" stroke="url(#${idp}l)" ${s}/>` +
      `<path d="${RIGHT}" stroke="url(#${idp}r)" ${s}/>` +
      `<path d="${BODY}" stroke="url(#${idp}b)" stroke-opacity=".8" ${s}/>` +
      `<circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r}" fill="url(#${idp}h)"/>`,
  };
}

const svg = (viewBox, inner, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">${inner}</svg>\n`;

function markSvg(mode) {
  const m = markShapes(mode);
  return svg(MARK_VIEWBOX, `<title>WonderID</title>${m.defs}${m.body}`, "WonderID");
}

// -------------------------------------------------------------- wordmark
const outlines = JSON.parse(readFileSync(join(here, "wordmark-outlines.json"), "utf8"));
const CAP = outlines.capHeight;

/** Paths for `text` at `weight`, starting at x=0 on the baseline, with tracking in font units. */
function setText(text, weight, tracking = 0) {
  const glyphs = outlines.weights[String(weight)];
  let x = 0;
  const parts = [];
  for (const ch of text) {
    const g = glyphs[ch];
    if (!g) throw new Error(`no outline for ${JSON.stringify(ch)} at ${weight}`);
    if (g.d) parts.push(`<path transform="translate(${x} 0)" d="${g.d}"/>`);
    x += g.advance + tracking;
  }
  return { paths: parts.join(""), width: x - tracking };
}

const TAGLINE = "IDENTITIES • AGENTS • ACCESS • SECURITY";

/**
 * Horizontal lockup: mark, then "Wonder" + "ID". Mark 100 high; the
 * wordmark's cap height is 60% of it, its baseline level with the arms'
 * lower curve.
 */
function lockupSvg(mode, { tagline = false } = {}) {
  const scale = 60 / CAP;
  const wonder = setText("Wonder", 700, -18);
  const id = setText("ID", 700, -10);
  const gapWord = -14; // "r" to "I", tightened like the sheet
  const wordWidth = (wonder.width + gapWord + id.width) * scale;
  const x0 = 136;
  const baseline = 80;
  const wonderInk = mode === "color" ? C.navy : mode === "color-dark" ? C.white : mode === "mono-dark" ? C.navy : C.white;
  const idInk = mode === "color" ? C.blue : mode === "color-dark" ? C.blueOnDark : wonderInk;
  // The full-colour mark reads on navy as on white (the sheet's dark lockup).
  const mm = markShapes(mode === "color-dark" ? "color" : mode);

  let inner =
    `<title>WonderID</title>${mm.defs}${mm.body}` +
    `<g transform="translate(${x0} ${baseline}) scale(${scale.toFixed(5)})">` +
    `<g fill="${wonderInk}">${wonder.paths}</g>` +
    `<g fill="${idInk}" transform="translate(${wonder.width + gapWord} 0)">${id.paths}</g>` +
    `</g>`;
  let width = Math.ceil(x0 + wordWidth + 2);
  let height = 100;
  if (tagline) {
    const tScale = 12.5 / CAP;
    const t = setText(TAGLINE, 500, 190);
    const tInk = mode === "color" ? "#64748B" : mode === "color-dark" ? C.slate : wonderInk;
    // Tagline spans the wordmark's width, below it.
    const fit = Math.min(tScale, wordWidth / t.width);
    inner += `<g fill="${tInk}" transform="translate(${x0 + 2} ${baseline + 26}) scale(${fit.toFixed(5)})">${t.paths}</g>`;
    height = 112;
    width = Math.max(width, Math.ceil(x0 + 2 + t.width * fit + 2));
  }
  return svg(`0 0 ${width} ${height}`, inner, "WonderID");
}

// ------------------------------------------------------------------ write
const files = {
  "logo/wonderid-mark.svg": markSvg("color"),
  "logo/wonderid-mark-dark.svg": markSvg("color"), // full colour reads on navy as on white (sheet: app icon on navy)
  "logo/wonderid-mark-light.svg": markSvg("color"),
  "logo/wonderid-mark-monochrome.svg": markSvg("mono-dark"),
  "logo/wonderid-mark-monochrome-light.svg": markSvg("mono-light"),
  "logo/wonderid-logo.svg": lockupSvg("color"),
  "logo/wonderid-logo-light.svg": lockupSvg("color"),
  "logo/wonderid-logo-dark.svg": lockupSvg("color-dark"),
  "logo/wonderid-monochrome.svg": lockupSvg("mono-dark"),
  "logo/wonderid-monochrome-light.svg": lockupSvg("mono-light"),
  "logo/wonderid-logo-tagline.svg": lockupSvg("color", { tagline: true }),
  "logo/wonderid-logo-tagline-dark.svg": lockupSvg("color-dark", { tagline: true }),
  "favicon/favicon.svg": markSvg("color"),
};
for (const [p, body] of Object.entries(files)) {
  mkdirSync(dirname(out(p)), { recursive: true });
  writeFileSync(out(p), body);
}
console.log(`wrote ${Object.keys(files).length} SVGs to public/brand/`);

// The logo component sizes images from these, so nothing shifts on load.
const manifest = Object.fromEntries(
  Object.entries(files).map(([p, body]) => {
    const [, , w, h] = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(body).slice(1).map(Number);
    return [p, { src: `/brand/${p}`, width: w, height: h }];
  }),
);
writeFileSync(join(root, "modules", "ui", "brandAssets.generated.json"), JSON.stringify(manifest, null, 2) + "\n");

// ----------------------------------------------------------------- raster
if (process.argv.includes("--raster")) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const markUrl = `data:image/svg+xml;base64,${Buffer.from(markSvg("color")).toString("base64")}`;
  async function shoot(path, w, h, html) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0">${html}</body></html>`);
    await page.screenshot({ path: out(path), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  }
  const icon = (size, bg, radius, pad) =>
    `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg};border-radius:${radius}px"><img src="${markUrl}" style="width:${size - pad * 2}px"></div>`;
  await shoot("favicon/favicon-16.png", 16, 16, icon(16, "transparent", 0, 0));
  await shoot("favicon/favicon-32.png", 32, 32, icon(32, "transparent", 0, 1));
  await shoot("favicon/favicon-48.png", 48, 48, icon(48, "transparent", 0, 2));
  // Apple touch: the sheet's white app icon (iOS adds its own corner mask).
  await shoot("favicon/apple-touch-icon.png", 180, 180, icon(180, "#FFFFFF", 0, 26));
  const lockDark = `data:image/svg+xml;base64,${Buffer.from(lockupSvg("color-dark", { tagline: true })).toString("base64")}`;
  const hero = (w, h) =>
    `<div style="width:${w}px;height:${h}px;background:linear-gradient(135deg,${C.navy} 0%,#0B1A45 60%,#1B1560 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif">` +
    `<img src="${lockDark}" style="width:${Math.round(w * 0.56)}px">` +
    `</div>`;
  await shoot("social/wonderid-og.png", 1200, 630, hero(1200, 630));
  await shoot("social/wonderid-twitter.png", 1200, 600, hero(1200, 600));
  await browser.close();
  // Next.js serves these from app/ as the site icons.
  copyFileSync(out("favicon/favicon-32.png"), join(root, "app", "icon.png"));
  copyFileSync(out("favicon/apple-touch-icon.png"), join(root, "app", "apple-icon.png"));
  console.log("wrote favicons, app icons and social images");
}
