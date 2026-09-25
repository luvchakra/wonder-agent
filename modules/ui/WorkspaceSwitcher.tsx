"use client";

import { useTransition } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TenantOption } from "./AccountPanel";

/**
 * Organization switcher, pinned above the account panel at the foot of the
 * navigation rail. It is the ONE tenant-switching surface: a header chip
 * that duplicated it was removed on 2026-09-18 by user decision. Because it
 * lives on the navy rail it colours itself from the --sidebar* tokens, not
 * --foreground/--accent (those invert with the theme; the rail does not).
 *
 * Ported structurally from WonderArk's BusinessSwitcher
 * (packages/core/src/components/shell/business-switcher.tsx,
 * luvchakra/founder-collab): a DropdownMenu listing
 * every organization with a check mark on the current one, and a
 * "Create new" item always last, separated by a divider. Reuses the same
 * tenant-membership data/action AccountPanel's own tenant list wires up —
 * not a fabricated second data source; "tenant" is still the underlying
 * domain term (CLAUDE.md's locked tenancy model), "organization" is only
 * the user-facing label. "Create new" links to /onboarding (WonderAgent's
 * real tenant-creation flow) rather than inventing a modal WonderArk's
 * own onCreateBusiness callback has no WonderAgent equivalent for yet.
 *
 * Items call `onSelectTenant` directly (via useTransition) instead of a
 * `<form action>` wrapped in DropdownMenu.Item asChild — that pattern
 * looked right but doesn't reliably submit: Radix closes/unmounts the
 * menu on selection in the same tick, which can race the browser's
 * native form submission and silently drop it before the server action
 * ever runs. Calling the (server) action function directly sidesteps
 * that entirely — it's not tied to the triggering DOM node's lifetime.
 */
export function WorkspaceSwitcher({
  tenants,
  onSelectTenant,
  compact = false,
}: {
  tenants: TenantOption[];
  onSelectTenant: (formData: FormData) => void | Promise<void>;
  /** The collapsed sidebar: the building icon alone, its name as the label. */
  compact?: boolean;
}) {
  const current = tenants.find((t) => t.current);
  const [, startTransition] = useTransition();

  function selectTenant(tenantId: string) {
    const formData = new FormData();
    formData.set("tenantId", tenantId);
    startTransition(() => {
      void onSelectTenant(formData);
    });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Switch organization"
          title={compact ? current?.name ?? "Select organization" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-2.5 rounded-lg text-left text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-ring",
            compact ? "mx-auto size-11 justify-center" : "w-full px-2 py-2",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
            <Building2 className="size-4" aria-hidden="true" />
          </span>
          <span className={cn("min-w-0 flex-1", compact && "sr-only")}>
            <span className="block truncate text-sm font-medium">{current?.name ?? "Select organization"}</span>
            <span className="block truncate text-xs text-sidebar-muted-foreground">
              {current?.slug ? `wonderagent.app/${current.slug}` : "No organization selected"}
            </span>
          </span>
          {compact ? null : <ChevronDown className="size-4 shrink-0 text-sidebar-muted-foreground" aria-hidden="true" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side={compact ? "right" : "top"}
          sideOffset={6}
          className="z-[60] w-64 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          {tenants.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No organizations yet.</p>
          ) : (
            tenants.map((t) => (
              <DropdownMenu.Item
                key={t.id}
                onSelect={() => selectTenant(t.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-sm px-3 py-2 outline-none hover:bg-accent focus-visible:bg-accent",
                  t.current && "font-medium",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.current && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </DropdownMenu.Item>
            ))
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <Link
              href="/onboarding"
              className="flex items-center gap-2 rounded-sm px-3 py-2 text-primary outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <Plus className="size-4" aria-hidden="true" />
              Create new organization
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
