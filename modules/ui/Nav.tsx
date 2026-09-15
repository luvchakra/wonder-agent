"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronRight, Menu, X } from "lucide-react";
import { NavIcon } from "./NavIcon";
import type { TenantOption } from "./AccountPanel";

export type NavGroup = {
  label: string;
  href: string;
  icon?: string;
  children?: { label: string; href: string }[];
};

/**
 * EXPERIENCE-P0-09 (UX-P0-16), restructured to match WonderArk's actual
 * shell (packages/core/src/components/shell/app-sidebar.tsx +
 * sidebar-toggle.tsx in luvchakra/founder-collab — the platform's own
 * sibling product and the literal source of record, not a screenshot
 * approximation): the drawer sits *below* the topbar (`top-14 bottom-0`,
 * scrim starts at `top-14` too) so the topbar stays visible/usable while
 * open, rather than a full-viewport modal. Built on Radix Dialog rather
 * than WonderArk's bare conditional div — same visual result, but keeps
 * Radix's focus-trap/aria-modal for free (Rule 8, accessibility is
 * mandatory) instead of regressing to WonderArk's hand-rolled Escape/
 * backdrop listeners. A "Tenants" section (WonderArk's "Businesses")
 * sits between the nav groups and the account panel; the primary
 * tenant switcher itself lives in the topbar (WorkspaceSwitcher),
 * matching WonderArk's BusinessSwitcher placement, not here.
 */
export function Nav({
  groups,
  tenants,
  onSelectTenant,
  footer,
}: {
  groups: NavGroup[];
  tenants?: TenantOption[];
  onSelectTenant?: (formData: FormData) => void | Promise<void>;
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
            className="fixed top-14 bottom-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl focus:outline-none"
            aria-label="Main navigation"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Menu</span>
              <Dialog.Close
                aria-label="Close sidebar"
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:scale-90"
              >
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>

            <div className="border-t border-sidebar-border" />

            <nav aria-label="Main" className="flex flex-col py-1">
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

            {tenants && tenants.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1.5">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tenants</span>
                </div>
                <div className="flex flex-col divide-y divide-sidebar-border border-t border-sidebar-border">
                  {tenants.map((t) => (
                    <form action={onSelectTenant} key={t.id}>
                      <input type="hidden" name="tenantId" value={t.id} />
                      <button
                        type="submit"
                        onClick={() => setOpen(false)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-sidebar-accent ${
                          t.current ? "bg-sidebar-accent font-medium" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {t.current && <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
                      </button>
                    </form>
                  ))}
                </div>
              </>
            )}

            <div className="mt-auto flex flex-col">{footer}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
