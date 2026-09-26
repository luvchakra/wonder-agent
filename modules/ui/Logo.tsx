import Image from "next/image";
import { wonderIdBrand, type BrandAsset } from "./brand";

/**
 * BRAND-003 (EXPERIENCE-P0-22, 2026-09-26) — the WonderID logo and, kept
 * deliberately separate, a tenant's logo (§68–§70 of the branding
 * specification).
 *
 * `<WonderIDLogo />` renders only the brand's own assets from
 * public/brand/ — the supplied brand sheet's artwork — never a URL it is handed, sized from their intrinsic
 * dimensions so nothing shifts on load. It is a Server Component: no
 * client JavaScript. On themed surfaces the `default` variant renders the
 * light- and dark-background artwork and CSS shows the one that matches
 * (`.theme-light-only` / `.theme-dark-only`, app/globals.css), so the
 * right logo is there on first paint; surfaces that are dark in both
 * themes (the navy sidebar) ask for `dark`.
 */

export type WonderIDLogoVariant = "default" | "light" | "dark" | "mono" | "mono-light";
const SIZES = { xs: 20, sm: 24, md: 32, lg: 44, xl: 56 } as const;
export type WonderIDLogoSize = keyof typeof SIZES | number;

function pick(variant: Exclude<WonderIDLogoVariant, "default">, showWordmark: boolean, showTagline: boolean): BrandAsset {
  const a = wonderIdBrand.assets;
  // The sheet has one mark for light and one for dark surfaces (no monochrome mark).
  if (!showWordmark) return variant === "dark" || variant === "mono-light" ? a.markDark : a.mark;
  if (showTagline && (variant === "light" || variant === "dark")) return variant === "dark" ? a.logoTaglineDark : a.logoTagline;
  return variant === "mono" ? a.monochrome : variant === "mono-light" ? a.monochromeLight : variant === "dark" ? a.logoDark : a.logo;
}

function LogoImage({ asset, height, alt, priority, className }: { asset: BrandAsset; height: number; alt: string; priority?: boolean; className?: string }) {
  const width = Math.round((asset.width / asset.height) * height);
  return (
    <Image
      src={asset.src}
      width={width}
      height={height}
      alt={alt}
      // Our own small brand files: served as-is, so the path is stable.
      unoptimized
      priority={priority}
      draggable={false}
      className={className}
      style={{ height, width: "auto", maxWidth: "100%" }}
    />
  );
}

export function WonderIDLogo({
  variant = "default",
  size = "md",
  showWordmark = true,
  showTagline = false,
  alt = wonderIdBrand.name,
  priority,
  className,
}: {
  variant?: WonderIDLogoVariant;
  /** Rendered height: a named size or pixels. The full lockup reads from ~24px; below that use the mark. */
  size?: WonderIDLogoSize;
  showWordmark?: boolean;
  /** The tagline lockup — for brand-introducing surfaces only (sign-in, landing), never the app shell (§5). */
  showTagline?: boolean;
  /** Accessible name; pass "" when an ancestor (a labelled link) already names it. */
  alt?: string;
  priority?: boolean;
  className?: string;
}) {
  const height = typeof size === "number" ? size : SIZES[size];
  if (variant !== "default") {
    return <LogoImage asset={pick(variant, showWordmark, showTagline)} height={height} alt={alt} priority={priority} className={className} />;
  }
  const light = pick("light", showWordmark, showTagline);
  const dark = pick("dark", showWordmark, showTagline);
  if (light.src === dark.src) return <LogoImage asset={light} height={height} alt={alt} priority={priority} className={className} />;
  return (
    <>
      <LogoImage asset={light} height={height} alt={alt} priority={priority} className={`theme-light-only ${className ?? ""}`} />
      <LogoImage asset={dark} height={height} alt={alt} priority={priority} className={`theme-dark-only ${className ?? ""}`} />
    </>
  );
}

/**
 * A customer organization's mark (§70). Never the WonderID logo, and
 * never mixed with it. Organizations have no uploaded logo yet (that
 * arrives with tenant branding settings), so this is the organization's
 * initials on a neutral tile — identity, not decoration.
 */
export function TenantLogo({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials =
    name
      .split(/[\s\-_.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-secondary font-semibold text-secondary-foreground ${className ?? ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}
