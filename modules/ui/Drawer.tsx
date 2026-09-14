"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * EXPERIENCE-P0-06 — reads/writes a single query-string param that names
 * the currently-open evidence item (e.g. `?evidence=runtime_event:abc123`)
 * while leaving every other param (filters, sort, page — whatever the
 * underlying list already has in the URL) untouched. This is what makes a
 * drawer's URL shareable/restorable without dropping the list's context,
 * per the story's acceptance criteria.
 */
export function useEvidenceDrawerParam(paramName = "evidence") {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(paramName);

  const open = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(paramName, id);
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, paramName],
  );

  const close = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(paramName);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams, paramName]);

  return { value, open, close };
}

/**
 * A contextual side-drawer for evidence detail (runtime events, access-path
 * detail, finding evidence, certification evidence) — built on the existing
 * `@radix-ui/react-dialog` dependency, not a new library, so it inherits
 * Radix's focus-trap/Escape-to-close/aria-modal behavior for free
 * (EXPERIENCE-P0-05). Opens over the current page without navigating away
 * from it, preserving the underlying list's scroll/filter/pagination state.
 */
export function EvidenceDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-md focus:outline-none sm:max-w-lg">
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-text-primary">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-xs text-text-secondary">{description}</Dialog.Description>}
            </div>
            <Dialog.Close
              aria-label="Close evidence drawer"
              className="rounded-md p-1 text-text-secondary hover:bg-surface-elevated hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              ✕
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
