"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavIcon } from "./NavIcon";
import { AccountPanel, type TenantOption } from "./AccountPanel";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { SHELL_NAV, isNavItemActive, type ShellBadgeCounts } from "./shell-nav";

/**
 * The customer shell's primary navigation.
 *
 * One component renders it twice: as the permanently-visible rail from
 * `lg` up, and as a slide-in drawer below that. The body is shared so the
 * two can never drift — the only difference is the drawer's close button
 * and the fact that following a link inside it dismisses it.
 *
 * The surface is a deep navy in both themes (see the --sidebar* tokens in
 * app/globals.css). Nothing in here may use --foreground or
 * --muted-foreground: those invert with the theme and would render dark
 * text on the dark rail in light mode.
 */

export type SidebarUser = {
  email: string;
  displayName: string | null;
  roleLabel: string | null;
  isPlatformAdmin: boolean;
};

type SidebarProps = {
  badges: ShellBadgeCounts;
  tenants: TenantOption[];
  user: SidebarUser;
  onSelectTenant: (formData: FormData) => void | Promise<void>;
  onSignOut: (formData: FormData) => void | Promise<void>;
};

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
        W
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-sidebar-foreground">
          WonderAgent
        </span>
        <span className="block truncate text-[11px] text-sidebar-muted-foreground">Govern. Trust. Enable.</span>
      </span>
    </Link>
  );
}

function NavList({ badges, onNavigate }: { badges: ShellBadgeCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-1">
      <ul className="space-y-0.5">
        {SHELL_NAV.map((item) => {
          const active = isNavItemActive(item, pathname, SHELL_NAV);
          const count = item.badge ? badges[item.badge] : undefined;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-[18px] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {count ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                      item.badge === "risk"
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-primary text-primary-foreground",
                    )}
                  >
                    {count > 99 ? "99+" : count}
                    <span className="sr-only"> needing attention</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarBody({ badges, tenants, user, onSelectTenant, onSignOut, onNavigate }: SidebarProps & { onNavigate?: () => void }) {
  return (
    <>
      <Brand />
      <NavList badges={badges} onNavigate={onNavigate} />
      <div className="shrink-0 border-t border-sidebar-border px-2 py-2">
        <WorkspaceSwitcher tenants={tenants} onSelectTenant={onSelectTenant} variant="sidebar" />
      </div>
      <AccountPanel
        email={user.email}
        displayName={user.displayName}
        subtitle={user.roleLabel}
        isPlatformAdmin={user.isPlatformAdmin}
        onSignOut={onSignOut}
      />
    </>
  );
}

/** The permanently-visible rail, `lg` and up. */
export function AppSidebar(props: SidebarProps) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 lg:hidden" />
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
