import Link from "next/link";
import { LinkButton, ThemeToggle, Logo } from "@/modules/ui";
import { getSessionUser } from "@/lib/tenant/session";

/**
 * Public chrome for the help centre — no login required (EXPERIENCE, 2026-
 * 09-18: the guide and FAQ are product documentation, identical for every
 * visitor and containing no customer data, so there is no reason to gate
 * them behind a session).
 *
 * Deliberately its own layout rather than the `(customer)` shell: it calls
 * only `getSessionUser()`, which returns null instead of redirecting, so
 * this renders correctly for a signed-out visitor. It never calls
 * `getTenantContext()` or anything that assumes a membership.
 *
 * The one auth-aware bit is the header's call to action — a signed-in
 * visitor gets "Back to app" instead of "Log in" / "Get started" — which is
 * why this can't just reuse `app/welcome/layout.tsx` (that layout is for
 * signed-out visitors only; proxy.ts redirects a signed-in user away from
 * `/welcome`, but `/help` stays reachable either way).
 */
export default async function HelpLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

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
          <Link href="/" aria-label="WonderAgent" className="flex items-center">
            <Logo variant="lockup" height={30} priority />
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            {user ? (
              <LinkButton href="/" size="sm" className="shrink-0 rounded-full px-4">
                Back to app
              </LinkButton>
            ) : (
              <>
                <LinkButton href="/sign-in" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Log in
                </LinkButton>
                <LinkButton href="/sign-up" size="sm" className="shrink-0 rounded-full px-4">
                  Get started
                </LinkButton>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
