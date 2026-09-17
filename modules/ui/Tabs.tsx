"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Underlined tab set, as the design uses inside panels (the dashboard's
 * activity panel, the agent detail header). Radix supplies the roving
 * focus and aria wiring; this only styles it.
 *
 * The strip scrolls horizontally rather than wrapping, so a panel with
 * several tabs stays one row deep on a phone.
 */
export function Tabs({
  tabs,
  defaultValue,
  children,
  className,
  ariaLabel,
}: {
  tabs: Array<{ value: string; label: string; count?: number }>;
  defaultValue?: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <RadixTabs.Root defaultValue={defaultValue ?? tabs[0]?.value} className={className}>
      <RadixTabs.List
        aria-label={ariaLabel}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              "shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors",
              "hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              "data-[state=active]:border-primary data-[state=active]:text-primary",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="ml-1.5 tabular-nums text-muted-foreground">({tab.count})</span>
            ) : null}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export const TabPanel = RadixTabs.Content;
