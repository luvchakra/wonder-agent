"use client";

import { MoreHorizontal } from "lucide-react";
import { openMobileNav } from "./AppSidebar";

/**
 * Below `lg`, a floating "More" button at the bottom right (owner request,
 * 2026-10-14: a floating button, not a bar). It opens the same navigation
 * drawer the rail shows on desktop, so nothing in SHELL_NAV is unreachable
 * on a phone.
 *
 * It sits above the home indicator (`env(safe-area-inset-bottom)`), and the
 * shell keeps space under the page content so it never covers the last row
 * of a table.
 */
export function MobileTabBar() {
  return (
    <nav aria-label="Primary" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 lg:hidden">
      <button
        type="button"
        onClick={openMobileNav}
        aria-label="More"
        className="flex size-14 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <MoreHorizontal className="size-6" aria-hidden="true" />
      </button>
    </nav>
  );
}
