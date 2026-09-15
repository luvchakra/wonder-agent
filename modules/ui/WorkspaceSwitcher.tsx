"use client";

import { useTransition } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TenantOption } from "./AccountPanel";

/**
 * Topbar organization switcher — ported structurally from WonderArk's
 * BusinessSwitcher (packages/core/src/components/shell/
 * business-switcher.tsx, luvchakra/founder-collab): a plain text+chevron
 * trigger next to the logo (not a bordered pill), a DropdownMenu listing
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
}: {
  tenants: TenantOption[];
  onSelectTenant: (formData: FormData) => void | Promise<void>;
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
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="truncate">{current?.name ?? "Select organization"}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
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
