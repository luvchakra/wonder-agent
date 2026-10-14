import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { baseAppHost } from "@/lib/tenant/host";
import { mainAppUrl } from "@/lib/tenant/hostTenant";
import { requestOrigin, siteOf } from "@/modules/ui/install/manifest";
import { InstallNow } from "./InstallNow";

export const metadata: Metadata = { title: "Install the app" };

/**
 * Owner request 2026-10-14: the one WonderID app, installed from the main
 * address, opens every organization and environment in its own window
 * (manifest scope_extensions). On an organization address this page sends
 * the browser to the main address's.
 */
export default async function InstallPage() {
  const h = await headers();
  const site = siteOf(requestOrigin(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto")), baseAppHost());
  if (site?.kind === "organization") {
    const main = await mainAppUrl();
    if (main) redirect(`${main}/install`);
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold text-foreground">Install WonderID</h1>
      <p className="text-sm text-muted-foreground">One app for all your organizations and environments. Switching between them stays in the app.</p>
      <InstallNow />
    </main>
  );
}
