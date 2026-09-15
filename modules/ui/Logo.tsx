import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * Icon-only logo mark next to the hamburger toggle — matches WonderArk's
 * own LogoMark placement/sizing (packages/core/src/components/shell/
 * app-topbar.tsx: `<Link aria-label="CoFounderAI"><LogoMark
 * className="h-8 w-auto" /></Link>`, no visible wordmark alongside it).
 * WonderArk's mark is a branded image asset this repo doesn't have; a
 * simple icon-in-a-primary-tile mark stands in for it rather than
 * reusing WonderArk's own branding.
 */
export function Logo() {
  return (
    <Link
      href="/"
      aria-label="WonderAgent"
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-transform active:scale-95"
    >
      <ShieldCheck className="size-5" aria-hidden="true" />
    </Link>
  );
}
