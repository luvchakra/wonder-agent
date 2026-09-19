import Image, { type StaticImageData } from "next/image";

/**
 * Device framing for real product screenshots on the public landing page.
 *
 * Every shot is captured twice — once light, once dark — and both are
 * rendered, with `.theme-light-only` / `.theme-dark-only` (app/globals.css)
 * deciding which is visible. Doing it in CSS rather than JS means the right
 * image is correct on first paint, with no flash and no client component.
 *
 * The chrome is deliberately understated: a hairline border, one layered
 * shadow and a real rounded bezel, so the screenshot reads as a product
 * rather than as a sticker. No gradient fills, no glow
 * (docs/design/UI-UX-DESIGN-RULES.md §5).
 */

function ThemedImage({
  light,
  dark,
  alt,
  sizes,
  priority,
  className,
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <>
      <Image
        src={light}
        alt={alt}
        sizes={sizes}
        priority={priority}
        className={`theme-light-only h-auto w-full ${className ?? ""}`}
      />
      <Image
        src={dark}
        alt=""
        aria-hidden="true"
        sizes={sizes}
        priority={priority}
        className={`theme-dark-only h-auto w-full ${className ?? ""}`}
      />
    </>
  );
}

/** Desktop screenshot inside a restrained browser window. */
export function BrowserFrame({
  light,
  dark,
  alt,
  label = "agent.WonderApps.biz",
  priority,
  className,
  sizes = "(min-width: 1024px) 60vw, 100vw",
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  label?: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  return (
    <figure
      className={`overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_oklch(0.16_0.015_257/0.06),0_12px_28px_-8px_oklch(0.16_0.015_257/0.18),0_40px_80px_-24px_oklch(0.16_0.015_257/0.22)] ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="mx-auto hidden rounded-md border border-border bg-background px-3 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
          {label}
        </span>
      </div>
      <ThemedImage light={light} dark={dark} alt={alt} sizes={sizes} priority={priority} />
    </figure>
  );
}

/** Mobile screenshot inside a phone bezel. */
export function PhoneFrame({
  light,
  dark,
  alt,
  className,
  sizes = "(min-width: 1024px) 220px, 180px",
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  className?: string;
  sizes?: string;
}) {
  return (
    <figure
      className={`overflow-hidden rounded-[2rem] border-[6px] border-foreground/85 bg-foreground/85 shadow-[0_8px_20px_-6px_oklch(0.16_0.015_257/0.25),0_30px_60px_-18px_oklch(0.16_0.015_257/0.35)] ${className ?? ""}`}
    >
      <div className="relative overflow-hidden rounded-[1.6rem] bg-card">
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1.5 z-10 h-1.5 w-14 -translate-x-1/2 rounded-full bg-foreground/25"
        />
        <ThemedImage light={light} dark={dark} alt={alt} sizes={sizes} />
      </div>
    </figure>
  );
}
