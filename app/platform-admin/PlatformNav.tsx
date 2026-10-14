"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/platform-admin", label: "Platform Overview" },
  { href: "/platform-admin/tenants", label: "Organizations" },
  { href: "/platform-admin/billing", label: "Billing" },
  { href: "/platform-admin/features", label: "Feature Flags" },
  { href: "/platform-admin/branding", label: "Global Configuration" },
  { href: "/platform-admin/announcements", label: "Announcements" },
  { href: "/platform-admin/health", label: "Platform Health" },
  { href: "/platform-admin/admins", label: "Platform Admins" },
];

/** The vendor console's own navigation (never the customer shell's, non-negotiable #3). */
export function PlatformNav({ bootstrap = false }: { bootstrap?: boolean }) {
  const pathname = usePathname();
  // WID-H10: the PLATFORM_ADMIN_EMAILS bootstrap opens only Platform Admins.
  const items = bootstrap ? NAV.filter((item) => item.href === "/platform-admin/admins") : NAV;
  return (
    <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {items.map((item) => {
        const active = item.href === "/platform-admin" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                active ? "bg-sidebar-primary text-primary" : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
