"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays, ChevronDown, Loader2 } from "lucide-react";

export type PeriodOption = { value: string; label: string };

/**
 * The page-header period picker from the light-console mockups ("Last 30
 * days"). It is a real filter: the choice goes into the URL (`?range=`),
 * the Server Component re-renders with it, and the page stays shareable and
 * back-button friendly. A spinner shows while the new data loads (CLAUDE.md
 * §15), since the select itself changes instantly.
 */
export function PeriodSelect({
  options,
  value,
  param = "range",
  label = "Period",
}: {
  options: PeriodOption[];
  value: string;
  param?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="relative inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card pl-3 pr-8 text-sm text-card-foreground shadow-sm focus-within:outline focus-within:outline-2 focus-within:outline-ring">
      <span className="sr-only">{label}</span>
      {pending ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(searchParams.toString());
          next.set(param, e.target.value);
          startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
        }}
        className="h-full cursor-pointer appearance-none bg-transparent pr-1 font-medium outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}
