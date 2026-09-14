"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavGroup = {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
};

/**
 * EXPERIENCE-P0-01.2. Collapses to a drawer below 1024px (the `lg` Tailwind
 * breakpoint) rather than simply shrinking the desktop layout — a hamburger
 * button toggles an overlay drawer on narrow viewports; the same nav
 * renders as a static rail at lg+ widths.
 */
export function Nav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const list = (
    <ul className="space-y-4 p-4 text-sm">
      {groups.map((group) => (
        <li key={group.href}>
          <Link
            href={group.href}
            onClick={() => setOpen(false)}
            className={`block rounded-md px-2 py-1.5 font-medium ${
              isActive(group.href) ? "bg-accent/10 text-accent" : "text-text-primary hover:bg-surface-elevated"
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
                    className={`block rounded-md px-2 py-1 text-xs ${
                      isActive(child.href) ? "text-accent" : "text-text-secondary hover:text-text-primary"
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
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-40 rounded-md border border-border bg-surface p-2 shadow-sm lg:hidden"
      >
        <span aria-hidden>☰</span>
      </button>

      <nav className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">{list}</nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <nav className="absolute left-0 top-0 h-full w-64 bg-surface shadow-md">{list}</nav>
        </div>
      )}
    </>
  );
}
