import { notFound } from "next/navigation";
import { requirePlatformAdminOrBootstrap } from "@/lib/rbac/requirePlatformAdmin";
import { WonderIDLogo } from "@/modules/ui";
import { PlatformNav } from "./PlatformNav";

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
  // WID-H10: a PLATFORM_ADMIN_EMAILS address (the bootstrap) reaches only
  // Platform Admins; the rest of the console is in (console), which needs a
  // platform_admins entry.
  let bootstrap = false;
  try {
    ({ bootstrap } = await requirePlatformAdminOrBootstrap());
  } catch {
    notFound();
  }
  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <aside className="border-b border-sidebar-border bg-sidebar lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
        <nav aria-label="Platform" className="px-4 py-3 lg:sticky lg:top-0 lg:py-5">
          <div className="mb-3 flex items-center gap-2 px-1 lg:mb-6">
            <WonderIDLogo size={26} />
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Platform</span>
          </div>
          <PlatformNav bootstrap={bootstrap} />
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6">{children}</div>
      </main>
    </div>
  );
}
