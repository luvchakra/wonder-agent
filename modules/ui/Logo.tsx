/**
 * The WonderID logo (EXPERIENCE-P0-18, 2026-09-26), in the three forms the
 * product needs.
 *
 * - `mark`   — the W alone, for square and small placements (the sidebar,
 *   anywhere under ~28px).
 * - `lockup` — W + "WonderID", the default for headers.
 * - `full`   — lockup + the tagline, for the places that introduce the
 *   product (auth screens, onboarding).
 *
 * The mark is inline SVG drawn with solid brand colours: two strokes and
 * the lighter overlap where they cross, as in the WonderID mockups. No
 * gradient `<defs>`: an id-referenced gradient breaks when its first
 * instance sits in a hidden subtree, and the mark renders several times
 * per page. The wordmark is live text in the theme's foreground colour,
 * so it reads on light and dark surfaces without paired raster assets.
 * (The WonderAgent raster logo files remain in assets/brand/ for the
 * record; nothing renders them.)
 */
export type LogoVariant = "mark" | "lockup" | "full";

export const WONDERID_TAGLINE = "Govern every identity. Verify every access.";

/** The W. Aspect 4:3; sized by height. */
export function WonderIdMark({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 48" height={height} width={Math.round((height * 64) / 48)} className={className} aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="9">
        <path d="M7 8 L20.5 40 L32 17" stroke="#5B5BF0" />
        <path d="M32 17 L43.5 40 L57 8" stroke="#A04DF2" />
        <path d="M24.5 30.5 L32 17 L39.5 30.5" stroke="#8B7CF6" />
      </g>
    </svg>
  );
}

export function Logo({
  variant = "lockup",
  height = 28,
  /** Accessible name. Omit when an ancestor (a link, say) is already labelled. */
  alt,
  className,
}: {
  variant?: LogoVariant;
  height?: number;
  alt?: string;
  className?: string;
  /** Kept for call-site compatibility with the raster logo; inline SVG needs no preload. */
  priority?: boolean;
}) {
  const label = alt ? { role: "img" as const, "aria-label": alt } : { "aria-hidden": true };

  if (variant === "mark") {
    return (
      <span {...label} className={className}>
        <WonderIdMark height={height} />
      </span>
    );
  }

  // The lockup's text is sized from the requested height so call sites
  // keep the proportions they had with the raster wordmark.
  const markHeight = variant === "full" ? Math.round(height * 0.62) : height;
  const fontSize = variant === "full" ? Math.round(height * 0.5) : Math.round(height * 0.72);
  return (
    <span {...label} className={`inline-flex max-w-full flex-col items-center ${className ?? ""}`}>
      <span className="inline-flex max-w-full items-center gap-[0.35em]" style={{ fontSize }}>
        <WonderIdMark height={markHeight} className="shrink-0" />
        <span className="truncate font-semibold leading-none tracking-[-0.02em] text-foreground">WonderID</span>
      </span>
      {variant === "full" ? (
        <span className="mt-1.5 text-center text-[0.8125rem] font-medium tracking-[0.01em] text-muted-foreground">{WONDERID_TAGLINE}</span>
      ) : null}
    </span>
  );
}
