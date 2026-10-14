"use client";

import { MoreHorizontal } from "lucide-react";
import { openMobileNav } from "./AppSidebar";

/**
 * Bottom bar, below `lg`: only "More" (owner request, 2026-10-14; the four
 * shortcut tabs are gone). It opens the same navigation drawer the rail
 * shows on desktop, so nothing in SHELL_NAV is unreachable on a phone.
 *
 * It sits above the home indicator via `pb-[env(safe-area-inset-bottom)]`,
 * and the shell reserves matching space under the page content so the bar
 * never covers the last row of a table.
 */
export function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openMobileNav}
          className="flex w-20 flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
