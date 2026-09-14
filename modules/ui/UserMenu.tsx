"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ThemeToggle } from "./theme";

export type TenantOption = { id: string; name: string; slug: string; current: boolean };

export function UserMenu({
  email,
  tenants,
  onSelectTenant,
  onSignOut,
}: {
  email: string;
  tenants: TenantOption[];
  onSelectTenant: (formData: FormData) => void | Promise<void>;
  onSignOut: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm hover:bg-surface-elevated">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden text-text-secondary sm:inline">{email}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-border bg-surface p-2 shadow-md"
        >
          <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">Theme</div>
          <div className="px-2 pb-2">
            <ThemeToggle />
          </div>

          {tenants.length > 1 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">Switch tenant</div>
              {tenants.map((t) => (
                <form action={onSelectTenant} key={t.id}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <DropdownMenu.Item asChild>
                    <button
                      type="submit"
                      className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                        t.current ? "bg-accent/10 text-accent" : "text-text-primary hover:bg-surface-elevated"
                      }`}
                    >
                      {t.name}
                    </button>
                  </DropdownMenu.Item>
                </form>
              ))}
            </>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <form action={onSignOut}>
            <DropdownMenu.Item asChild>
              <button type="submit" className="w-full rounded-md px-2 py-1.5 text-left text-sm text-danger hover:bg-danger/10">
                Sign out
              </button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
