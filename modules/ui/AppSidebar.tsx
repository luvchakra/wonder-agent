"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavIcon } from "./NavIcon";
import { Logo } from "./Logo";
import type { TenantOption } from "./AccountPanel";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { SHELL_NAV, activeChildHref, isNavItemActive, type ShellBadgeCounts } from "./shell-nav";

/**
 * The customer shell's primary navigation.
 *
 * One component renders it twice: as the permanently-visible rail from
 * `lg` up, and as a slide-in drawer below that. The body is shared so the
 * two can never drift — the only difference is the drawer's close button
 * and the fact that following a link inside it dismisses it.
 *
 * Light-console rail (2026-09-25 mockups): white surface, the current
 * section as a filled primary pill with its sub-pages listed beneath it
 * on a hairline guide. Colours come from the themed --sidebar* tokens in
 * app/globals.css. The account menu moved to the page header, matching
 * the mockups; organization switching stays at the foot of the rail
 * (user decision, 2026-09-18).
 */

/** The signed-in user as the shell shows them (header account menu). */
export type SidebarUser = {
  email: string;
  displayName: string | null;
  roleLabel: string | null;
  isPlatformAdmin: boolean;
};

type SidebarProps = {
  badges: ShellBadgeCounts;
  tenants: TenantOption[];
  onSelectTenant: (formData: FormData) => void | Promise<void>;
};

function Brand() {
  return (
    <Link
      href="/"
      className="flex h-16 shrink-0 items-center gap-2.5 px-5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <Logo variant="mark" height={30} className="shrink-0" />
      <span className="truncate text-[17px] font-semibold tracking-[-0.015em] text-sidebar-foreground">WonderAgent</span>
    </Link>
  );
}

function CountBadge({ count, tone }: { count: number; tone: "risk" | "discovery" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
        tone === "risk" ? "bg-destructive text-destructive-foreground" : "bg-primary/15 text-primary",
      )}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only"> needing attention</span>
    </span>
  );
}

function NavList({ badges, onNavigate }: { badges: ShellBadgeCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
      <ul className="space-y-1">
        {SHELL_NAV.map((item) => {
          const active = isNavItemActive(item, pathname, SHELL_NAV);
          const count = item.badge ? badges[item.badge] : undefined;
          // A section's sub-pages are listed while it is the current one,
          // like the mockups' accordion rail. A lone sub-page adds nothing.
          const children = active && (item.children?.length ?? 0) > 1 ? item.children! : [];
          const currentChild = children.length ? activeChildHref(item, pathname) : null;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? (currentChild ? "true" : "page") : undefined}
                data-active={active || undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  active
                    ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                    : "font-medium text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-[18px] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {count ? (
                  active ? (
                    <span className="shrink-0 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums">
                      {count > 99 ? "99+" : count}
                      <span className="sr-only"> needing attention</span>
                    </span>
                  ) : (
                    <CountBadge count={count} tone={item.badge!} />
                  )
                ) : null}
              </Link>
              {children.length ? (
                <ul aria-label={`${item.label} pages`} className="mb-1 ml-[1.35rem] mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
                  {children.map((child) => {
                    const childActive = child.href === currentChild;
                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          onClick={onNavigate}
                          aria-current={childActive ? "page" : undefined}
                          className={cn(
                            "block truncate rounded-md px-3 py-1.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                            childActive
                              ? "bg-accent font-semibold text-accent-foreground"
                              : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarBody({ badges, tenants, onSelectTenant, onNavigate }: SidebarProps & { onNavigate?: () => void }) {
  return (
    <>
      <Brand />
      <NavList badges={badges} onNavigate={onNavigate} />
      <div className="shrink-0 border-t border-sidebar-border px-3 py-2">
        <WorkspaceSwitcher tenants={tenants} onSelectTenant={onSelectTenant} />
      </div>
    </>
  );
}

/** The permanently-visible rail, `lg` and up. */
export function AppSidebar(props: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <SidebarBody {...props} />
    </aside>
  );
}

/**
 * Below `lg`, the same navigation as a drawer. The trigger lives in the
 * mobile tab bar's "More" slot, so this component owns only the panel and
 * is opened through the `wonderagent:open-nav` event — a deliberate
 * choice over lifting state into the layout, which is a Server Component
 * and cannot hold it.
 */
export function MobileNavDrawer(props: SidebarProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openDrawer = () => setOpen(true);
    window.addEventListener("wonderagent:open-nav", openDrawer);
    return () => window.removeEventListener("wonderagent:open-nav", openDrawer);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col bg-sidebar shadow-2xl focus:outline-none lg:hidden">
          {/* The dialog's accessible name comes from this title — an
              aria-label alongside it would be silently ignored, since
              Radix wires up aria-labelledby. */}
          <Dialog.Title className="sr-only">Main navigation</Dialog.Title>
          <Dialog.Close
            aria-label="Close navigation"
            className="absolute right-3 top-4 flex size-8 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </Dialog.Close>
          <SidebarBody {...props} onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Opens the drawer above. Used by the tab bar's "More" slot. */
export function openMobileNav() {
  window.dispatchEvent(new Event("wonderagent:open-nav"));
}

/** A plain trigger, for surfaces that want one outside the tab bar. */
export function MobileNavTrigger() {
  return (
    <button
      type="button"
      onClick={openMobileNav}
      aria-label="Open navigation"
      className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
    >
      <Menu className="size-5" aria-hidden="true" />
    </button>
  );
}
