import assets from "./brandAssets.generated.json";

/**
 * BRAND-002 (EXPERIENCE-P0-22, 2026-09-26) — the one WonderID brand
 * configuration. Name, taglines, palette and asset paths live here and
 * nowhere else; CSS reads the same palette from app/globals.css
 * (`--brand-*`), which this mirrors for places CSS cannot reach (e-mail,
 * generated images, charts drawn in code).
 *
 * Source: docs/requirements/WonderID_Branding_Application_Wide_Implementation_Requirements.md.
 * The artwork under public/brand/ is interim, built by
 * scripts/brand/build-assets.mjs from the brand sheet until official
 * vector files are supplied (same file names, so they drop in).
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
    logo: asset("logo/wonderid-logo.svg"),
    /** Full colour with a light wordmark, for dark backgrounds. */
    logoDark: asset("logo/wonderid-logo-dark.svg"),
    logoLight: asset("logo/wonderid-logo-light.svg"),
    logoTagline: asset("logo/wonderid-logo-tagline.svg"),
    logoTaglineDark: asset("logo/wonderid-logo-tagline-dark.svg"),
    monochrome: asset("logo/wonderid-monochrome.svg"),
    monochromeLight: asset("logo/wonderid-monochrome-light.svg"),
    mark: asset("logo/wonderid-mark.svg"),
    markDark: asset("logo/wonderid-mark-dark.svg"),
    markLight: asset("logo/wonderid-mark-light.svg"),
    markMonochrome: asset("logo/wonderid-mark-monochrome.svg"),
    markMonochromeLight: asset("logo/wonderid-mark-monochrome-light.svg"),
    favicon: asset("favicon/favicon.svg"),
    social: "/brand/social/wonderid-og.png",
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
