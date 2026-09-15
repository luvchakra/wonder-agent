"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { TenantOption } from "./AccountPanel";

/**
 * UX-004 (12_ADVANCED_PRODUCT_UX_REQUIREMENTS.md §6) — "All Workspaces"
 * entry pinned to the top of the nav drawer, above the nav groups. Reuses
 * the same tenant-membership data/action AccountPanel's "Switch tenant"
 * section already wires up (Foundation's tenant_memberships, via
 * app/(customer)/layout.tsx) rather than inventing a second data source —
 * this is WonderAgent's real multi-tenant switcher, not a fabricated
 * "workspace" concept.
 */
export function WorkspaceSwitcher({
  tenants,
  onSelectTenant,
}: {
  tenants: TenantOption[];
  onSelectTenant: (formData: FormData) => void | Promise<void>;
}) {
  const current = tenants.find((t) => t.current);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden className="text-base leading-none">
            ▦
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">All Workspaces</span>
          {tenants.length > 1 && <span aria-hidden className="text-muted-foreground">⌄</span>}
        </button>
      </DropdownMenu.Trigger>

      {tenants.length > 1 && (
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-[60] w-64 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
          >
            <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Switch workspace</p>
            {tenants.map((t) => (
              <form action={onSelectTenant} key={t.id}>
                <input type="hidden" name="tenantId" value={t.id} />
                <DropdownMenu.Item asChild>
                  <button
                    type="submit"
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                      t.current ? "bg-primary/10 text-primary" : "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {t.name}
                  </button>
                </DropdownMenu.Item>
              </form>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      )}
      {current && tenants.length <= 1 && <span className="sr-only">Current workspace: {current.name}</span>}
    </DropdownMenu.Root>
  );
}
