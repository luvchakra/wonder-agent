import Link from "next/link";
import { LinkButton, ThemeToggle, WonderIDLogo } from "@/modules/ui";

/**
 * Public marketing chrome. Deliberately separate from the authenticated
 * `(customer)` shell: no nav drawer, no tenant switcher, no session — this
 * layout renders for signed-out visitors, so it must never call
 * getTenantContext() or anything that assumes a user.
 */
const NAV = [
  { href: "#model", label: "The solution" },
  { href: "#platform", label: "Platform" },
  { href: "#whats-new", label: "What's new" },
  { href: "#how-it-works", label: "How it works" },
  { href: "/help", label: "Help" },
] as const;

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
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

          <nav aria-label="Primary" className="ml-6 hidden items-center gap-6 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            {/* The toggle is a three-option segmented control; below `sm` the
                header cannot hold it alongside the wordmark and the primary
                CTA without overflowing, and the page still follows the OS
                colour scheme there. */}
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            <LinkButton href="/sign-in" variant="ghost" size="sm" className="hidden sm:inline-flex">
              Log in
            </LinkButton>
            <LinkButton href="/sign-up" size="sm" className="shrink-0 rounded-full px-4">
              Get started
            </LinkButton>
          </div>
        </div>
      </header>

      <main id="main">{children}</main>
    </div>
  );
}
