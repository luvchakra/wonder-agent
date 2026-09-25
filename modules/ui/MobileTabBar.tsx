"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavIcon } from "./NavIcon";
import { openMobileNav } from "./AppSidebar";
import { MOBILE_TABS, isNavItemActive, type ShellBadgeCounts } from "./shell-nav";

/**
 * Bottom tab bar, below `lg`. Four destinations plus "More", which opens
 * the same navigation drawer the rail shows on desktop — so nothing in
 * SHELL_NAV is unreachable on a phone.
 *
 * It sits above the home indicator via `pb-[env(safe-area-inset-bottom)]`,
 * and the shell reserves matching space under the page content so the bar
 * never covers the last row of a table.
 */
export function MobileTabBar({ badges }: { badges: ShellBadgeCounts }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex items-stretch">
        {MOBILE_TABS.map((item) => {
          const active = isNavItemActive(item, pathname, MOBILE_TABS);
          const count = item.badge ? badges[item.badge] : undefined;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <NavIcon name={item.icon} className="size-5" />
                  {count ? (
                    <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-destructive-foreground">
                      {count > 9 ? "9+" : count}
                    </span>
                  ) : null}
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={openMobileNav}
            className="flex w-full flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
