import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";

// Wholly separate authorization boundary from the customer-facing shell —
// CLAUDE.md non-negotiable #3. This layout never extends or imports
// app/layout.tsx's customer navigation. Platform Agent (Module 09) owns the
// actual console UI; Foundation only owns this authorization gate.
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
  return <>{children}</>;
}
