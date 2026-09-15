"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, Menu, X } from "lucide-react";
import { NavIcon } from "./NavIcon";

export type NavGroup = {
  label: string;
  href: string;
  icon?: string;
  children?: { label: string; href: string }[];
};

/**
 * EXPERIENCE-P0-09 (UX-P0-16), restructured to match WonderArk's actual
 * shell (packages/core/src/components/shell/app-sidebar.tsx +
 * sidebar-toggle.tsx in luvchakra/founder-collab): the drawer sits
 * *below* the topbar (`top-14 bottom-0`, scrim starts at `top-14` too)
 * so the topbar stays visible/usable while open, rather than a
 * full-viewport modal. Built on Radix Dialog rather than WonderArk's
 * bare conditional div — same visual result, but keeps Radix's
 * focus-trap/aria-modal for free (Rule 8, accessibility is mandatory).
 *
 * Only the nav-groups region scrolls (`flex-1 overflow-y-auto`) — the
 * header and the account panel (`footer`) are `shrink-0` siblings
 * outside that scroll container, so the account panel stays pinned to
 * the bottom of the drawer regardless of how long the nav list gets or
 * how far it's scrolled, instead of scrolling away with it. No separate
 * tenant list lives here anymore either — the topbar's WorkspaceSwitcher
 * is the only tenant-switching surface now, so the account panel is the
 * drawer's sole bottom content.
 */
export function Nav({
  groups,
  footer,
}: {
  groups: NavGroup[];
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // Sub-menus are collapsed by default; a group only starts expanded when
  // the current page is inside it, so the active section's still visible
  // on load. From there, only the arrow button opens/closes a group — the
  // label itself always navigates, it never toggles.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.children?.some((c) => isActive(c.href))).map((g) => g.href)),
  );
  const toggleExpanded = (href: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:scale-90"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 top-14 z-30 bg-black/50" />
          <Dialog.Content
            className="fixed top-14 bottom-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl focus:outline-none"
            aria-label="Main navigation"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Menu</span>
              <Dialog.Close
                aria-label="Close sidebar"
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:scale-90"
              >
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>

            <div className="shrink-0 border-t border-sidebar-border" />

            <nav aria-label="Main" className="flex flex-1 flex-col overflow-y-auto py-1">
              {groups.map((group) => {
                const active = isActive(group.href);
                const hasChildren = !!group.children?.length;
                const isOpen = expanded.has(group.href);
                return (
                  <div key={group.href}>
                    <div className={`flex items-center hover:bg-sidebar-accent ${active ? "bg-sidebar-accent" : ""}`}>
                      <Link
                        href={group.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      >
                        <NavIcon name={group.icon} className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{group.label}</span>
                      </Link>
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(group.href)}
                          aria-label={isOpen ? `Collapse ${group.label}` : `Expand ${group.label}`}
                          aria-expanded={isOpen}
                          className="flex shrink-0 items-center justify-center self-stretch px-3 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        >
                          <ChevronRight className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {hasChildren && isOpen && (
                      <div className="ml-3 border-l border-sidebar-border pl-6">
                        {group.children!.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setOpen(false)}
                            aria-current={isActive(child.href) ? "page" : undefined}
                            className={`block py-1.5 text-sm ${
                              isActive(child.href) ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>

            <div className="shrink-0">{footer}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
