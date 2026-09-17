"use client";

import { useTransition } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronsUpDown, LogOut, Shield, SunMoon, User } from "lucide-react";
import { ThemeToggle } from "./theme";
import { Avatar } from "./Avatar";

export type TenantOption = { id: string; name: string; slug: string; current: boolean };

/**
 * Account menu pinned to the bottom of the nav drawer — ported
 * structurally from WonderArk's SidebarAccountMenu (packages/core/src/
 * components/shell/sidebar-account-menu.tsx, luvchakra/founder-collab):
 * a compact avatar+name(+chevron) trigger row (no email until expanded),
 * opening upward into a name/email header, a divider, one icon+label row
 * per destination, and Log Out last as a plain row (not styled red —
 * WonderArk's own Log Out is a ghost button, not a destructive one), and
 * invoked directly via onSelect/useTransition rather than a nested
 * `<form>` (see WorkspaceSwitcher's comment for why that pattern silently
 * drops the submission). Organization switching lives only in the
 * topbar's WorkspaceSwitcher now — not repeated here. Menu contents
 * otherwise stay scoped to WonderAgent's real surfaces (Settings,
 * Appearance, admin console) — WonderArk's Usage/Billing items are that
 * app's own domain, not carried over into a screen that doesn't have
 * them.
 */
export function AccountPanel({
  email,
  displayName,
  subtitle,
  isPlatformAdmin,
  onSignOut,
}: {
  email: string;
  displayName?: string | null;
  /** Second line under the name — the user's role in the current tenant. */
  subtitle?: string | null;
  isPlatformAdmin?: boolean;
  onSignOut: (formData: FormData) => void | Promise<void>;
}) {
  const name = displayName?.trim() || email;
  const [, startTransition] = useTransition();

  return (
    <div className="border-t border-sidebar-border">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <Avatar name={displayName} email={email} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name}</span>
              {subtitle ? (
                <span className="block truncate text-xs text-sidebar-muted-foreground">{subtitle}</span>
              ) : null}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={4}
            className="z-[60] w-64 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>

            <DropdownMenu.Separator className="my-1 h-px bg-border" />

            <DropdownMenu.Item asChild>
              <Link href="/settings" className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent">
                <User className="size-4 text-muted-foreground" aria-hidden="true" />
                Settings
              </Link>
            </DropdownMenu.Item>

            <div className="flex items-center gap-2 px-3 py-2">
              <SunMoon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-sm">Appearance</span>
              <ThemeToggle />
            </div>

            {isPlatformAdmin && (
              <DropdownMenu.Item asChild>
                <Link
                  href="/platform-admin"
                  className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <Shield className="size-4 text-muted-foreground" aria-hidden="true" />
                  Admin console
                </Link>
              </DropdownMenu.Item>
            )}

            <DropdownMenu.Separator className="my-1 h-px bg-border" />

            <DropdownMenu.Item
              onSelect={() => startTransition(() => void onSignOut(new FormData()))}
              className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
              Log Out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
