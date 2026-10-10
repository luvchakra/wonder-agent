import assets from "./brandAssets.generated.json";

/**
 * BRAND-002 (EXPERIENCE-P0-22, 2026-09-26) — the one WonderID brand
 * configuration. Name, taglines, palette and asset paths live here and
 * nowhere else; CSS reads the same palette from app/globals.css
 * (`--brand-*`), which this mirrors for places CSS cannot reach (e-mail,
 * generated images, charts drawn in code).
 *
 * Source: docs/requirements/WonderID_Branding_Application_Wide_Implementation_Requirements.md.
 * The artwork under public/brand/ is the user-supplied brand sheet
 * (docs/requirements/wonderid-brand-sheet.png), cut into its pieces by
 * scripts/brand/extract-assets.py — nothing redrawn. Official vector
 * files, when supplied, replace them.
 */

export type BrandAsset = { src: string; width: number; height: number };

const asset = (path: keyof typeof assets): BrandAsset => assets[path];

export const wonderIdBrand = {
  name: "WonderID",
  /** The brand tagline (§5): auth entry, landing, splash — not under every in-app logo. */
  tagline: "IDENTITIES • AGENTS • ACCESS • SECURITY",
  /** The secondary message (§6), for the landing and sign-in surfaces. */
  statement: "Secure every identity. Human and AI.",
  /** The generic product descriptor used in titles (§16). */
  descriptor: "AI Identity Security",
  colors: {
    navy: "#08122C",
    blue: "#2538FF",
    sky: "#06B6DA",
    violet: "#8B5CF6",
    slate: "#94A3B8",
    mist: "#F1F5F9",
  },
  /** Chart sequence (§47): categorical series only; states use semantic colours. */
  chartSequence: ["#2538FF", "#06B6DA", "#8B5CF6", "#08122C", "#94A3B8"],
  assets: {
    /** Full colour, for light backgrounds. */
    logo: asset("logo/wonderid-logo.png"),
    /** Full colour with a light wordmark, for dark backgrounds. */
    logoDark: asset("logo/wonderid-logo-dark.png"),
    logoTagline: asset("logo/wonderid-logo-tagline.png"),
    logoTaglineDark: asset("logo/wonderid-logo-tagline-dark.png"),
    /** Black ink, for light backgrounds. */
    monochrome: asset("logo/wonderid-monochrome.png"),
    /** White ink, for dark backgrounds. */
    monochromeLight: asset("logo/wonderid-monochrome-light.png"),
    mark: asset("logo/wonderid-mark.png"),
    markDark: asset("logo/wonderid-mark-dark.png"),
    favicon: asset("favicon/favicon-32.png"),
    appleTouchIcon: asset("favicon/apple-touch-icon.png"),
    social: asset("social/wonderid-og.png"),
  },
  /**
   * EXPERIENCE-P0-26 — the installed app (web app manifest, home-screen
   * icon, install banner). The icons are the mark above on a white tile,
   * resampled, nothing redrawn: `icon*` have rounded transparent corners;
   * `maskable512` is full-bleed with the mark inside the 80% safe circle.
   * The Apple touch icon stays app/apple-icon.png (the sheet's app icon).
   * Colours are theme tokens as hex, for the manifest and the theme-color
   * meta, which CSS cannot reach: `--card` (the header) light and dark,
   * and `--background` light.
   */
  app: {
    themeColor: "#ffffff",
    themeColorDark: "#13171f",
    backgroundColor: "#f3f6fa",
    icon192: { src: "/brand/app/icon-192.png", width: 192, height: 192 },
    icon512: { src: "/brand/app/icon-512.png", width: 512, height: 512 },
    maskable512: { src: "/brand/app/icon-maskable-512.png", width: 512, height: 512 },
  },
} as const;

/**
 * Browser tab titles (§18): "WonderID · Agents", or with the organization
 * "ACME · Agents · WonderID"; with nothing more specific,
 * "WonderID · AI Identity Security".
 */
export function brandTitle(page?: string | null, tenantName?: string | null): string {
  const name = wonderIdBrand.name;
  if (tenantName) return page ? `${tenantName} · ${page} · ${name}` : `${tenantName} · ${name}`;
  return page ? `${name} · ${page}` : `${name} · ${wonderIdBrand.descriptor}`;
}
