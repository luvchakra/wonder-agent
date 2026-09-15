"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ThemeToggle } from "./theme";
import { Avatar } from "./Avatar";

export type TenantOption = { id: string; name: string; slug: string; current: boolean };

/**
 * EXPERIENCE-P0-09 (UX-P0-17), reskinned per user-supplied reference
 * screenshot: an avatar + name/email trigger pinned to the bottom of the
 * nav drawer, opening a profile card (Radix DropdownMenu, nested inside
 * Nav's Dialog — the same combination ShellNotifications already proves
 * works in this codebase) above it. Menu contents stay scoped to
 * WonderAgent's real surfaces (Settings, Appearance, tenant switch, sign
 * out) — the reference app's Usage/Billing/"All My Businesses" items are
 * that app's own domain, not carried over.
 */
export function AccountPanel({
  email,
  displayName,
  tenants,
  isPlatformAdmin,
  onSelectTenant,
  onSignOut,
}: {
  email: string;
  displayName?: string | null;
  tenants: TenantOption[];
  isPlatformAdmin?: boolean;
  onSelectTenant: (formData: FormData) => void | Promise<void>;
  onSignOut: (formData: FormData) => void | Promise<void>;
}) {
  const name = displayName?.trim() || email;

  return (
    <div className="border-t border-border p-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Avatar name={displayName} email={email} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </span>
            <span aria-hidden className="text-muted-foreground">
              ⌃
            </span>
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={8}
            className="z-[60] w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
          >
            <div className="flex items-center gap-2 p-2">
              <Avatar name={displayName} email={email} size="lg" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-popover-foreground">{name}</span>
                <span className="block truncate text-xs text-muted-foreground" title={email}>
                  {email}
                </span>
              </span>
            </div>

            <DropdownMenu.Separator className="my-2 h-px bg-border" />

            <DropdownMenu.Item asChild>
              <Link
                href="/settings"
                className="block cursor-pointer rounded-md px-2 py-1.5 text-sm text-popover-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
              >
                Settings
              </Link>
            </DropdownMenu.Item>

            <div className="mt-1 px-2 py-1.5">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Appearance</p>
              <ThemeToggle />
            </div>

            {isPlatformAdmin && (
              <DropdownMenu.Item asChild>
                <Link
                  href="/platform-admin"
                  className="mt-1 block cursor-pointer rounded-md px-2 py-1.5 text-sm text-popover-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                >
                  Admin console
                </Link>
              </DropdownMenu.Item>
            )}

            {tenants.length > 1 && (
              <>
                <DropdownMenu.Separator className="my-2 h-px bg-border" />
                <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Switch tenant</p>
                <div className="mt-1 space-y-0.5">
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
                </div>
              </>
            )}

            <DropdownMenu.Separator className="my-2 h-px bg-border" />

            <form action={onSignOut}>
              <DropdownMenu.Item asChild>
                <button
                  type="submit"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10"
                >
                  Log out
                </button>
              </DropdownMenu.Item>
            </form>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
