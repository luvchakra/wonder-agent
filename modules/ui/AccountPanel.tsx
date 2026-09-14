"use client";

import { ThemeToggle } from "./theme";
import { Button } from "./Button";

export type TenantOption = { id: string; name: string; slug: string; current: boolean };

/**
 * EXPERIENCE-P0-09 (UX-P0-17). Account menu content, relocated to the
 * bottom of the nav drawer — no longer a topbar dropdown, and no user
 * avatar (UX-P0-15). Plain inline content, not a nested Radix
 * DropdownMenu, since it already lives inside the drawer's own Dialog.
 */
export function AccountPanel({
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
    <div className="border-t border-border p-3">
      <p className="truncate px-1 text-xs text-muted-foreground" title={email}>
        {email}
      </p>

      <div className="mt-2 px-1">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Theme</p>
        <ThemeToggle />
      </div>

      {tenants.length > 1 && (
        <div className="mt-3 px-1">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Switch tenant</p>
          <ul className="space-y-0.5">
            {tenants.map((t) => (
              <li key={t.id}>
                <form action={onSelectTenant}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <button
                    type="submit"
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                      t.current ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {t.name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={onSignOut} className="mt-3">
        <Button type="submit" variant="outline" className="w-full justify-start">
          Sign out
        </Button>
      </form>
    </div>
  );
}
