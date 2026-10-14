import { notFound, redirect } from "next/navigation";
import { platformConsoleAccess } from "@/lib/rbac/requirePlatformAdmin";

/**
 * WID-H10, owner decision 2026-10-14: every console page but Platform
 * Admins needs a `platform_admins` entry. A PLATFORM_ADMIN_EMAILS address
 * (the bootstrap) is sent to Platform Admins, where it can add one; anyone
 * else gets the same bare 404 as the parent layout.
 */
export default async function PlatformConsoleLayout({ children }: { children: React.ReactNode }) {
  const access = await platformConsoleAccess();
  if (access === "bootstrap") redirect("/platform-admin/admins");
  if (access !== "full") notFound();
  return <>{children}</>;
}
