import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";

const NAV = [
  { href: "/platform-admin", label: "Platform Overview" },
  { href: "/platform-admin/tenants", label: "Tenants" },
  { href: "/platform-admin/features", label: "Feature Flags" },
  { href: "/platform-admin/branding", label: "Global Configuration" },
  { href: "/platform-admin/health", label: "Platform Health" },
  { href: "/platform-admin/admins", label: "Platform Admins" },
];

// Wholly separate authorization boundary from the customer-facing shell —
// CLAUDE.md non-negotiable #3. This layout never extends or imports
// app/layout.tsx's customer navigation — PLATFORM-P0-01.1 requires a
// completely separate nav shell, built here since Platform Agent (Module
// 09) owns the actual console UI (Foundation only built the auth gate).
//
// A denial renders a bare 404 rather than a "you don't have permission"
// page — never a partial render, never navigation that reveals this
// console's structure to a non-platform-admin caller.
export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformAdmin();
  } catch {
    notFound();
  }
  return (
    <div style={{ display: "flex", fontFamily: "sans-serif", minHeight: "100vh" }}>
      <nav style={{ width: 220, borderRight: "1px solid #ccc", padding: "1rem" }}>
        <p style={{ fontWeight: "bold" }}>WonderAgent Platform</p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {NAV.map((item) => (
            <li key={item.href} style={{ margin: "0.5rem 0" }}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
    </div>
  );
}
