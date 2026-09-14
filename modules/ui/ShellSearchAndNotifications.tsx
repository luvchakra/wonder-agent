"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { NotYetAvailable } from "./States";

/**
 * EXPERIENCE-P0-07 — Shell Global Search & Notifications. Operations Agent
 * (module 10) owns search/notifications data and matching logic and hasn't
 * shipped a published contract yet (dormant as of this story) — Experience
 * Agent renders the top-bar entry points now so the shell's shape matches
 * the PRD, composing the same `NotYetAvailable` placeholder pattern used
 * elsewhere in this backlog until Operations Agent's contract exists; no
 * search/notification data is invented here.
 */
export function ShellGlobalSearch() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Search"
          className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden>🔍</span>
          <span className="hidden text-xs text-muted-foreground md:inline">Search…</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-24 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-popover text-popover-foreground p-4 shadow-md focus:outline-none">
          <Dialog.Title className="text-sm font-semibold text-popover-foreground">Search</Dialog.Title>
          <Dialog.Description className="sr-only">Global search across agents, findings and access</Dialog.Description>
          <div className="mt-3">
            <NotYetAvailable feature="Global search" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ShellNotifications() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden>🔔</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-72 rounded-lg border border-border bg-popover text-popover-foreground p-3 shadow-md">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notifications</p>
          <div className="mt-2">
            <NotYetAvailable feature="Notifications" />
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
