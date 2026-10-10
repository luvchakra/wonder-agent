"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, ChevronRight, ChevronsLeft, Menu, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavIcon } from "./NavIcon";
import { WonderIDLogo } from "./Logo";
import type { TenantOption } from "./AccountPanel";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import {
  NAV_COOKIE,
  activeArea,
  activeChildHref,
  isNavItemActive,
  searchNav,
  type ShellBadgeCounts,
  type ShellNavEntry,
  type ShellNavItem,
} from "./shell-nav";

/**
 * The WonderID navigation (EXPERIENCE-P0-18, 2026-09-26; user decision to
 * adopt the WonderID mockups' dark navy sidebar; 2026-09-26 later, the
 * branding specification's light console — EXPERIENCE-P0-23; 2026-10-10,
 * the owner's area arrangement, see shell-nav.ts).
 *
 * - **Expanded** (the default, `lg` and up): the area list, each area a
 *   row that opens the area's own menu in place of the list; the menu
 *   starts with the area's name and a back arrow. A page is a plain row,
 *   a group folds open beneath its row. The menu follows the page: opening
 *   a page shows its area, with the page current and its group open. A
 *   search box above filters the menu (pages only, never data).
 * - **Collapsed**: an icon rail of the areas. Each opens a flyout on
 *   hover, click or keyboard, and a group inside it opens as a second
 *   flyout. The choice is remembered in the `wa_nav` cookie, which the
 *   layout reads, so the server renders the right width with no jump.
 * - **Below `lg`**: the expanded body as a drawer, opened from the tab
 *   bar's "More" slot.
 *
 * One body renders all three, so they cannot drift. Colours come from the
 * `--sidebar*` tokens in app/globals.css (light rail; dark in dark mode).
 */

/** The signed-in user as the shell shows them (header account menu). */
export type SidebarUser = {
  email: string;
  displayName: string | null;
  roleLabel: string | null;
  isPlatformAdmin: boolean;
};

type SidebarProps = {
  /** The areas and pages this viewer may open (navFor(SHELL_NAV, permissions)). */
  nav: ShellNavItem[];
  /** Shown in the footer, e.g. "v0.1.0 · 2cd03d4". */
  version: string;
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

const areaRowClass = (active: boolean) =>
  cn(
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors",
    focusRing,
    active
      ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-sm"
      : "font-medium text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );

/**
 * One row of the area list. An area with pages opens its menu in place of
 * the list (no navigation: the member then picks a page); an area with a
 * single page, or none, is a link to it.
 */
function AreaRow({ item, active, badges, onOpen, onNavigate }: { item: ShellNavItem; active: boolean; badges: ShellBadgeCounts; onOpen: () => void; onNavigate?: () => void }) {
  const count = item.badge ? badges[item.badge] : undefined;
  const inner = (
    <>
      <NavIcon name={item.icon} className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count ? <CountBadge count={count} tone={item.badge!} /> : null}
    </>
  );
  const single = !item.children?.length || (item.children.length === 1 && item.children[0].kind === "link");
  if (single) {
    return (
      <li>
        <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} data-active={active || undefined} className={areaRowClass(active)}>
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={onOpen} data-active={active || undefined} aria-label={`${item.label}${count ? `, ${count} needing attention` : ""}`} className={areaRowClass(active)}>
        {inner}
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </button>
    </li>
  );
}

/** An area's menu: its name with a back arrow to the area list, then its pages and groups. */
function AreaMenu({ item, active, pathname, onBack, onNavigate }: { item: ShellNavItem; active: boolean; pathname: string; onBack: () => void; onNavigate?: () => void }) {
  const currentHref = active ? activeChildHref(item, pathname) : null;
  const listId = `nav-area-${item.label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <>
      <div className="mb-2 flex items-center gap-1 border-b border-sidebar-border pb-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="All areas"
          title="All areas"
          className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground", focusRing)}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <h2 className="flex min-w-0 items-center gap-2 px-1 text-[13.5px] font-semibold text-sidebar-foreground">
          <NavIcon name={item.icon} className="size-4 shrink-0 text-sidebar-ring" />
          <span className="truncate">{item.label}</span>
        </h2>
      </div>
      <ul id={listId} aria-label={`${item.label} pages`} className="space-y-0.5">
        {(item.children ?? []).map((entry) =>
          entry.kind === "link" ? (
            <li key={entry.href}>
              <PageLink label={entry.label} href={entry.href} current={entry.href === currentHref} onNavigate={onNavigate} />
            </li>
          ) : (
            <GroupEntry key={entry.label} entry={entry} currentHref={currentHref} onNavigate={onNavigate} />
          ),
        )}
      </ul>
    </>
  );
}

/** The menu search's results: matching pages with where they live. */
function SearchResults({ nav, query, onNavigate }: { nav: ShellNavItem[]; query: string; onNavigate?: () => void }) {
  const matches = searchNav(nav, query);
  if (!matches.length) {
    return (
      <p role="status" className="px-3 py-2 text-[13px] text-sidebar-muted-foreground">
        No menu item matches.
      </p>
    );
  }
  return (
    <ul aria-label="Matching pages" className="space-y-0.5">
      {matches.map((m) => (
        <li key={m.href}>
          <Link href={m.href} onClick={onNavigate} className={cn("block rounded-md px-3 py-1.5 text-[13px] text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground", focusRing)}>
            <span className="block truncate font-medium text-sidebar-foreground">{m.label}</span>
            {m.trail.length ? <span className="block truncate text-[11px]">{m.trail.join(" › ")}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The expanded body's navigation: the area list, or the open area's menu,
 * or the search results. The open area follows the page; the back arrow
 * shows the list without leaving the page.
 */
function ExpandedNav({ nav, badges, pathname, onNavigate }: { nav: ShellNavItem[]; badges: ShellBadgeCounts; pathname: string; onNavigate?: () => void }) {
  const current = activeArea(nav, pathname);
  const [openLabel, setOpenLabel] = useState<string | null>(current?.label ?? null);
  // Arriving on another area's page opens that area (state derived from a
  // changing prop, adjusted during render).
  const [wasCurrent, setWasCurrent] = useState(current?.label ?? null);
  if ((current?.label ?? null) !== wasCurrent) {
    setWasCurrent(current?.label ?? null);
    setOpenLabel(current?.label ?? null);
  }
  const [query, setQuery] = useState("");
  const open = openLabel ? nav.find((a) => a.label === openLabel) : undefined;
  const openIsMenu = open && open.children && !(open.children.length === 1 && open.children[0].kind === "link");
  const trimmed = query.trim();
  return (
    <>
      <label className="relative mb-2 block">
        <span className="sr-only">Search menu</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-sidebar-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search menu"
          className={cn(
            "h-9 w-full rounded-md border border-sidebar-border bg-transparent pl-8 pr-2 text-[13px] text-sidebar-foreground placeholder:text-sidebar-muted-foreground",
            focusRing,
          )}
        />
      </label>
      {trimmed ? (
        <SearchResults nav={nav} query={trimmed} onNavigate={onNavigate} />
      ) : openIsMenu ? (
        <AreaMenu item={open} active={current?.label === open.label} pathname={pathname} onBack={() => setOpenLabel(null)} onNavigate={onNavigate} />
      ) : (
        <ul className="space-y-1">
          {nav.map((item) => (
            <AreaRow key={item.href} item={item} active={current?.label === item.label} badges={badges} onOpen={() => setOpenLabel(item.label)} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </>
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
  // BRAND-004: the lockup, following the theme (a light rail in light mode,
  // a dark one in dark mode); collapsed, the W mark alone — which is then the expand control.
  if (collapsed && onToggle) {
    return (
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-sidebar-border px-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand navigation"
          title="Expand navigation"
          className={cn("flex size-11 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent", focusRing)}
        >
          <WonderIDLogo showWordmark={false} size={26} alt="" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
      <Link href="/" className={cn("flex min-w-0 flex-1 items-center rounded-md", focusRing)}>
        <WonderIDLogo size={28} priority />
      </Link>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse navigation"
          title="Collapse navigation"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            focusRing,
          )}
        >
          <ChevronsLeft className="size-4" aria-hidden="true" />
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
  nav,
  version,
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
      <nav aria-label="Main" className={cn("sidebar-scroll flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
        {collapsed ? (
          <ul className="space-y-1.5">
            {nav.map((item) => (
              <CollapsedSection key={item.href} item={item} active={isNavItemActive(item, pathname, nav)} badges={badges} pathname={pathname} />
            ))}
          </ul>
        ) : (
          <ExpandedNav nav={nav} badges={badges} pathname={pathname} onNavigate={onNavigate} />
        )}
      </nav>
      <div className={cn("shrink-0 space-y-1 border-t border-sidebar-border py-2", collapsed ? "px-2" : "px-3")}>
        <AiEntry collapsed={collapsed} onNavigate={onNavigate} />
        <WorkspaceSwitcher tenants={tenants} onSelectTenant={onSelectTenant} compact={collapsed} />
        {collapsed ? null : (
          <p className="truncate px-3 pt-1 text-[11px] text-sidebar-muted-foreground" title={`WonderID ${version}`}>
            WonderID {version}
          </p>
        )}
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
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
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
