"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Menu, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavIcon } from "./NavIcon";
import { Logo } from "./Logo";
import type { TenantOption } from "./AccountPanel";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import {
  NAV_COOKIE,
  SHELL_NAV,
  activeChildHref,
  isNavItemActive,
  type ShellBadgeCounts,
  type ShellNavEntry,
  type ShellNavItem,
} from "./shell-nav";

/**
 * The WonderID navigation (EXPERIENCE-P0-18, 2026-09-26; user decision to
 * adopt the WonderID mockups' dark navy sidebar).
 *
 * - **Expanded** (the default, `lg` and up): sections as an accordion.
 *   The current section opens by itself; any section opens on click. A
 *   section's groups nest inline beneath it, each collapsible.
 * - **Collapsed**: an icon rail. Each section opens a flyout on hover,
 *   click or keyboard, and a group inside it opens as a third-level
 *   flyout. The choice is remembered in the `wa_nav` cookie, which the
 *   layout reads, so the server renders the right width with no jump.
 * - **Below `lg`**: the expanded body as a drawer, opened from the tab
 *   bar's "More" slot.
 *
 * One body renders all three, so they cannot drift. Colours come from the
 * `--sidebar*` tokens in app/globals.css (navy in both themes).
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

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-ring";

function CountBadge({ count, tone }: { count: number; tone: "risk" | "discovery" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
        tone === "risk" ? "bg-destructive text-white" : "bg-sidebar-primary text-sidebar-primary-foreground",
      )}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only"> needing attention</span>
    </span>
  );
}

// ---------------------------------------------------------------- expanded

function PageLink({ label, href, current, onNavigate, inset }: { label: string; href: string; current: boolean; onNavigate?: () => void; inset?: boolean }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative block truncate rounded-md py-1.5 pr-3 text-[13px] transition-colors",
        inset ? "pl-4" : "pl-3",
        focusRing,
        current
          ? "bg-sidebar-accent font-semibold text-sidebar-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-ring"
          : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function GroupEntry({ entry, currentHref, onNavigate }: { entry: Extract<ShellNavEntry, { kind: "group" }>; currentHref: string | null; onNavigate?: () => void }) {
  const containsCurrent = entry.children.some((c) => c.href === currentHref);
  const [open, setOpen] = useState(containsCurrent);
  // Navigating into the group opens it (adjusting state during render,
  // React's pattern for state derived from a changing prop).
  const [wasCurrent, setWasCurrent] = useState(containsCurrent);
  if (containsCurrent !== wasCurrent) {
    setWasCurrent(containsCurrent);
    if (containsCurrent) setOpen(true);
  }
  const id = `nav-group-${entry.label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors",
          focusRing,
          containsCurrent ? "font-semibold text-sidebar-foreground" : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />
      </button>
      {open ? (
        <ul id={id} aria-label={entry.label} className="mb-1 ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border">
          {entry.children.map((c) => (
            <li key={c.href}>
              <PageLink label={c.label} href={c.href} current={c.href === currentHref} onNavigate={onNavigate} inset />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ExpandedSection({ item, active, badges, pathname, onNavigate }: { item: ShellNavItem; active: boolean; badges: ShellBadgeCounts; pathname: string; onNavigate?: () => void }) {
  const [open, setOpen] = useState(active);
  // Following a link into another section opens it; leaving one does not
  // close it, so a section the user opened stays open.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setOpen(true);
  }
  const count = item.badge ? badges[item.badge] : undefined;
  const rowClass = cn(
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors",
    focusRing,
    active
      ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-sm"
      : "font-medium text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );
  const inner = (
    <>
      <NavIcon name={item.icon} className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count ? <CountBadge count={count} tone={item.badge!} /> : null}
    </>
  );

  if (!item.children?.length) {
    return (
      <li>
        <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} data-active={active || undefined} className={rowClass}>
          {inner}
        </Link>
      </li>
    );
  }

  const currentHref = active ? activeChildHref(item, pathname) : null;
  const listId = `nav-section-${item.label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={listId} data-active={active || undefined} onClick={() => setOpen((v) => !v)} className={rowClass}>
        {inner}
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
      </button>
      {open ? (
        <ul id={listId} aria-label={`${item.label} pages`} className="mb-1.5 ml-[1.35rem] mt-1 space-y-0.5 border-l border-sidebar-border pl-2">
          {item.children.map((entry) =>
            entry.kind === "link" ? (
              <li key={entry.href}>
                <PageLink label={entry.label} href={entry.href} current={entry.href === currentHref} onNavigate={onNavigate} />
              </li>
            ) : (
              <GroupEntry key={entry.label} entry={entry} currentHref={currentHref} onNavigate={onNavigate} />
            ),
          )}
        </ul>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------- collapsed

const flyoutPanel =
  "z-[60] min-w-56 rounded-lg border border-sidebar-border bg-sidebar p-1.5 text-sidebar-foreground shadow-2xl";
const flyoutItem = cn(
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] outline-none transition-colors",
  "text-sidebar-muted-foreground data-[highlighted]:bg-sidebar-accent data-[highlighted]:text-sidebar-foreground",
);

/**
 * One section in the icon rail. It opens on click and keyboard like any
 * menu, and on hover for a pointer: entering the icon opens it, and it
 * closes shortly after the pointer has left both the icon and the panel.
 */
function CollapsedSection({ item, active, badges, pathname }: { item: ShellNavItem; active: boolean; badges: ShellBadgeCounts; pathname: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = item.badge ? badges[item.badge] : undefined;
  const hoverOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const iconClass = cn(
    "relative flex size-11 items-center justify-center rounded-lg transition-colors",
    focusRing,
    active ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm" : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );
  const dot = count ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive ring-2 ring-sidebar" /> : null;

  if (!item.children?.length) {
    return (
      <li className="flex justify-center">
        <Link href={item.href} aria-label={item.label} title={item.label} aria-current={active ? "page" : undefined} className={iconClass}>
          <NavIcon name={item.icon} className="size-5" />
          {dot}
        </Link>
      </li>
    );
  }

  const currentHref = active ? activeChildHref(item, pathname) : null;
  return (
    <li className="flex justify-center" onPointerEnter={(e) => e.pointerType === "mouse" && hoverOpen()} onPointerLeave={(e) => e.pointerType === "mouse" && hoverClose()}>
      <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenu.Trigger
          aria-label={`${item.label}${count ? `, ${count} needing attention` : ""}`}
          data-active={active || undefined}
          className={iconClass}
          // Hovering has already opened the flyout by the time a mouse
          // press lands, and Radix's own press handler would toggle it shut
          // again. A mouse press therefore always opens; the keyboard keeps
          // Radix's toggle.
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button === 0) {
              e.preventDefault();
              hoverOpen();
            }
          }}
        >
          <NavIcon name={item.icon} className="size-5" />
          {dot}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="right"
            align="start"
            sideOffset={10}
            className={flyoutPanel}
            onPointerEnter={hoverOpen}
            onPointerLeave={hoverClose}
          >
            <DropdownMenu.Label className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted-foreground">{item.label}</DropdownMenu.Label>
            {item.children.map((entry) =>
              entry.kind === "link" ? (
                <DropdownMenu.Item key={entry.href} asChild className={cn(flyoutItem, entry.href === currentHref && "bg-sidebar-accent font-semibold text-sidebar-foreground")}>
                  <Link href={entry.href} aria-current={entry.href === currentHref ? "page" : undefined}>
                    {entry.label}
                  </Link>
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Sub key={entry.label}>
                  <DropdownMenu.SubTrigger className={cn(flyoutItem, "justify-between data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground")}>
                    <span className="flex items-center gap-2">
                      {entry.icon ? <NavIcon name={entry.icon} className="size-4" /> : null}
                      {entry.label}
                    </span>
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent sideOffset={6} className={flyoutPanel} onPointerEnter={hoverOpen} onPointerLeave={hoverClose}>
                      {entry.children.map((c) => (
                        <DropdownMenu.Item key={c.href} asChild className={cn(flyoutItem, c.href === currentHref && "bg-sidebar-accent font-semibold text-sidebar-foreground")}>
                          <Link href={c.href} aria-current={c.href === currentHref ? "page" : undefined}>
                            {c.label}
                          </Link>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              ),
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

// ---------------------------------------------------------------- body

function Brand({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  return (
    <div className={cn("flex h-16 shrink-0 items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "gap-2 px-4")}>
      {collapsed ? null : (
        <Link href="/" className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-md", focusRing)}>
          <Logo variant="mark" height={28} className="shrink-0" />
          <span className="truncate text-[18px] font-semibold tracking-[-0.015em] text-sidebar-foreground">WonderID</span>
        </Link>
      )}
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            focusRing,
          )}
        >
          {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}

function AiEntry({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  // The assistant today answers questions from the product documentation
  // (/help). The spec's full WonderID AI is EXPERIENCE-P0-20; this entry
  // promises only what exists.
  return (
    <Link
      href="/help"
      onClick={onNavigate}
      aria-label={collapsed ? "WonderID AI" : undefined}
      title={collapsed ? "WonderID AI" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg transition-colors hover:bg-sidebar-accent",
        focusRing,
        collapsed ? "mx-auto size-11 justify-center" : "px-3 py-2.5",
      )}
    >
      <Sparkles className="size-5 shrink-0 text-sidebar-ring" aria-hidden="true" />
      {collapsed ? null : (
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold text-sidebar-foreground">WonderID AI</span>
          <span className="block truncate text-xs text-sidebar-muted-foreground">Ask a question</span>
        </span>
      )}
    </Link>
  );
}

function SidebarBody({
  badges,
  tenants,
  onSelectTenant,
  collapsed,
  onToggle,
  onNavigate,
}: SidebarProps & { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <Brand collapsed={collapsed} onToggle={onToggle} />
      <nav aria-label="Main" className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
        <ul className={collapsed ? "space-y-1.5" : "space-y-1"}>
          {SHELL_NAV.map((item) =>
            collapsed ? (
              <CollapsedSection key={item.href} item={item} active={isNavItemActive(item, pathname, SHELL_NAV)} badges={badges} pathname={pathname} />
            ) : (
              <ExpandedSection key={item.href} item={item} active={isNavItemActive(item, pathname, SHELL_NAV)} badges={badges} pathname={pathname} onNavigate={onNavigate} />
            ),
          )}
        </ul>
      </nav>
      <div className={cn("shrink-0 space-y-1 border-t border-sidebar-border py-2", collapsed ? "px-2" : "px-3")}>
        <AiEntry collapsed={collapsed} onNavigate={onNavigate} />
        <WorkspaceSwitcher tenants={tenants} onSelectTenant={onSelectTenant} compact={collapsed} />
      </div>
    </>
  );
}

/** The permanently-visible sidebar, `lg` and up. */
export function AppSidebar({ initialCollapsed = false, ...props }: SidebarProps & { initialCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    // A per-viewer convenience: a cookie so the server renders the same
    // width on the next page (a year; lax; nothing sensitive).
    document.cookie = `${NAV_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      <SidebarBody {...props} collapsed={collapsed} onToggle={toggle} />
    </aside>
  );
}

/**
 * Below `lg`, the same navigation as a drawer (always the expanded
 * accordion). The trigger lives in the mobile tab bar's "More" slot, so
 * this component owns only the panel and is opened through the
 * `wonderagent:open-nav` event — a deliberate choice over lifting state
 * into the layout, which is a Server Component and cannot hold it.
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[88vw] flex-col bg-sidebar text-sidebar-foreground shadow-2xl focus:outline-none lg:hidden">
          {/* The dialog's accessible name comes from this title — an
              aria-label alongside it would be silently ignored, since
              Radix wires up aria-labelledby. */}
          <Dialog.Title className="sr-only">Main navigation</Dialog.Title>
          <Dialog.Close
            aria-label="Close navigation"
            className={cn(
              "absolute right-3 top-4 flex size-8 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              focusRing,
            )}
          >
            <X className="size-4" aria-hidden="true" />
          </Dialog.Close>
          <SidebarBody {...props} collapsed={false} onNavigate={() => setOpen(false)} />
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
