import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LinkButton, ThemeToggle, WonderIDLogo } from "@/modules/ui";
import { getSessionUser } from "@/lib/tenant/session";

/**
 * Chrome for the help guide. It needs a session (owner request, 2026-10-16;
 * the guide was public from 2026-09-18). proxy.ts sends a signed-out visitor
 * to sign-in with `next` set to the page asked for; this check is the
 * server-side enforcement behind it, so the content never renders without a
 * session even if the proxy is bypassed.
 *
 * Its own layout rather than the `(customer)` shell: someone signed in but
 * not yet in an organization can still read it. It calls only
 * `getSessionUser()`, never `getTenantContext()`.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function HelpLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?next=%2Fhelp");

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-foreground focus:outline focus:outline-2 focus:outline-ring"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="WonderID" className="flex items-center">
            <WonderIDLogo size={30} alt="" priority />
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            <LinkButton href="/" size="sm" className="shrink-0 rounded-full px-4">
              Back to app
            </LinkButton>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
