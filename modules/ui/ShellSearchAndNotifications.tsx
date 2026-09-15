"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, Search } from "lucide-react";
import { EmptyState } from "./States";
import { Badge } from "./Badge";

type SearchResult = {
  objectType: string;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  riskSeverity?: string | null;
  riskMasked?: boolean;
};

type Notification = {
  id: string;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * EXPERIENCE-P0-07 — Shell Global Search. Operations Agent has since
 * published its search contract (GET /api/v1/search) — this composes it
 * for real rather than the earlier NotYetAvailable placeholder.
 */
export function ShellGlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
        const body = await res.json();
        setResults(res.ok && body.ok ? body.data : []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const trimmedQuery = query.trim();
  const displayResults = trimmedQuery ? results : null;

  return (
    <Dialog.Root onOpenChange={(open) => !open && setQuery("")}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Search"
          className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="hidden text-xs text-muted-foreground md:inline">Search…</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-24 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-popover text-popover-foreground p-4 shadow-md focus:outline-none">
          <Dialog.Title className="text-sm font-semibold text-popover-foreground">Search</Dialog.Title>
          <Dialog.Description className="sr-only">Global search across agents, findings, applications, campaigns, policies and integrations</Dialog.Description>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents, findings, policies…"
            aria-label="Search query"
            className="mt-3 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          />
          <div className="mt-3 max-h-80 overflow-y-auto">
            {loading && <p className="text-sm text-muted-foreground">Searching…</p>}
            {!loading && displayResults && displayResults.length === 0 && <EmptyState title="No results" description={`Nothing matched "${query}".`} />}
            {!loading && displayResults && displayResults.length > 0 && (
              <ul className="space-y-1">
                {displayResults.map((r) => (
                  <li key={`${r.objectType}:${r.id}`}>
                    <Dialog.Close asChild>
                      <Link
                        href={r.href}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        <span>
                          <Badge tone="neutral">{r.objectType.replace(/_/g, " ")}</Badge>{" "}
                          {r.title}
                          {r.subtitle ? <span className="text-muted-foreground"> — {r.subtitle}</span> : null}
                        </span>
                        {r.riskMasked ? (
                          <span className="text-xs text-muted-foreground">risk hidden</span>
                        ) : r.riskSeverity ? (
                          <Badge tone={r.riskSeverity === "critical" || r.riskSeverity === "high" ? "danger" : "neutral"}>{r.riskSeverity}</Badge>
                        ) : null}
                      </Link>
                    </Dialog.Close>
                  </li>
                ))}
              </ul>
            )}
            {!trimmedQuery && <p className="text-sm text-muted-foreground">Start typing to search.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * EXPERIENCE-P0-07 — Shell Notifications, composing Operations Agent's
 * published GET /api/v1/notifications and POST /api/v1/notifications/:id/read.
 */
export function ShellNotifications() {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/notifications");
      const body = await res.json();
      setNotifications(res.ok && body.ok ? body.data : []);
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    await fetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
    setNotifications((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null);
  }

  const unreadCount = notifications?.filter((n) => !n.readAt).length ?? 0;

  return (
    <DropdownMenu.Root onOpenChange={(open) => open && load()}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-80 rounded-lg border border-border bg-popover text-popover-foreground p-3 shadow-md">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notifications</p>
          <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && notifications && notifications.length === 0 && <EmptyState title="No notifications" />}
            {!loading &&
              notifications?.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.readAt && markRead(n.id)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm ${n.readAt ? "text-muted-foreground" : "bg-accent/50 text-popover-foreground"} hover:bg-accent hover:text-accent-foreground`}
                >
                  <p className="font-medium">{n.title}</p>
                  <p className="mt-0.5 text-xs">{n.body}</p>
                </button>
              ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
