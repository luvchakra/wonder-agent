"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export type NavGroup = {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
};

/**
 * EXPERIENCE-P0-09 (UX-P0-16). The left navigation is a slide-in overlay
 * drawer at EVERY width — there is no permanently docked desktop rail,
 * unlike the previous EXPERIENCE-P0-01.2 behavior this supersedes. The
 * menu trigger renders inline wherever `<Nav>` is placed (the topbar's
 * left group in app/(customer)/layout.tsx) rather than a viewport-specific
 * floating button. `footer` renders the account panel pinned to the
 * drawer's bottom (UX-P0-17) — no separate topbar user menu.
 */
export function Nav({ groups, footer }: { groups: NavGroup[]; footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="rounded-md border border-border bg-background p-2 text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span aria-hidden>☰</span>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col bg-popover text-popover-foreground shadow-md focus:outline-none"
            aria-label="Main navigation"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <Dialog.Title className="text-sm font-semibold text-popover-foreground">WonderAgent</Dialog.Title>
              <Dialog.Close
                aria-label="Close navigation"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                ✕
              </Dialog.Close>
            </div>

            <nav aria-label="Main" className="flex-1 overflow-y-auto">
              <ul className="space-y-4 p-4 text-sm">
                {groups.map((group) => (
                  <li key={group.href}>
                    <Link
                      href={group.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(group.href) ? "page" : undefined}
                      className={`block rounded-md px-2 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                        isActive(group.href) ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      {group.label}
                    </Link>
                    {group.children && (
                      <ul className="ml-3 mt-1 space-y-0.5 border-l border-border pl-3">
                        {group.children.map((child) => (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              onClick={() => setOpen(false)}
                              aria-current={isActive(child.href) ? "page" : undefined}
                              className={`block rounded-md px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                                isActive(child.href) ? "text-primary" : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {child.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </nav>

            {footer}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
