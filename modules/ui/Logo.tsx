import Image, { type StaticImageData } from "next/image";
import markSrc from "@/assets/brand/wonderagent-mark.png";
import lockupLight from "@/assets/brand/wonderagent-wordmark-light.png";
import lockupDark from "@/assets/brand/wonderagent-wordmark-dark.png";
import fullLight from "@/assets/brand/wonderagent-logo-light.png";
import fullDark from "@/assets/brand/wonderagent-logo-dark.png";

/**
 * The WonderAgent logo, in the three forms the product actually needs.
 *
 * - `mark`   — the badge alone, for square and small placements (the nav
 *   rail, anywhere under ~28px). One asset: it is brand-coloured
 *   throughout, so it reads on light and dark alike.
 * - `lockup` — badge + wordmark, the default for headers.
 * - `full`   — badge + wordmark + the "Govern. Trust. Enable." tagline, for
 *   the places that introduce the product (auth screens, onboarding).
 *
 * `lockup` and `full` are theme-paired: the wordmark's "onder" is a dark
 * neutral that disappears on a dark surface, so a second asset carries a
 * light neutral instead. Both are rendered and `.theme-light-only` /
 * `.theme-dark-only` (app/globals.css) show exactly one — the same guards
 * the product screenshots use, which mirror the token blocks, so the logo
 * can never disagree with the surface behind it.
 *
 * Sized by height: width follows each asset's own aspect ratio, so the
 * variants stay in proportion wherever they are used. `max-w-full` caps
 * them at the container — the full lockup is 4.5:1, so at its natural
 * height it would otherwise be wider than a 320px screen.
 */
export type LogoVariant = "mark" | "lockup" | "full";

function scaled(src: StaticImageData, height: number) {
  return { height, width: Math.round((src.width / src.height) * height) };
}

export function Logo({
  variant = "lockup",
  height = 28,
  /** Accessible name. Omit when an ancestor (a link, say) is already labelled. */
  alt,
  className,
  priority,
}: {
  variant?: LogoVariant;
  height?: number;
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  const label = alt ? { role: "img" as const, "aria-label": alt } : { "aria-hidden": true };

  if (variant === "mark") {
    return (
      <Image
        src={markSrc}
        alt={alt ?? ""}
        {...scaled(markSrc, height)}
        priority={priority}
        className={`h-auto max-w-full ${className ?? ""}`}
      />
    );
  }

  const [light, dark] = variant === "full" ? [fullLight, fullDark] : [lockupLight, lockupDark];

  return (
    <span {...label} className={className}>
      <Image src={light} alt="" {...scaled(light, height)} priority={priority} className="theme-light-only h-auto max-w-full" />
      <Image src={dark} alt="" {...scaled(dark, height)} priority={priority} className="theme-dark-only h-auto max-w-full" />
    </span>
  );
}
