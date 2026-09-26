import Link from "next/link";
import { WonderIDLogo } from "./Logo";

/**
 * Shared chrome for the two public auth screens, so /sign-in and /sign-up
 * are visually continuous with the landing page instead of the raw
 * inline-styled scaffolding they shipped as. Presentational only — no
 * session, no tenant context, safe to render for a signed-out visitor.
 *
 * Kept deliberately quiet: one centred card on the same hairline grid the
 * landing hero uses, per docs/design/UI-UX-DESIGN-RULES.md §5 (layered
 * surfaces and restrained shadow, no gradient/glass/glow).
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <main className="relative flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-sm">
          <Link href="/" aria-label="WonderID" className="mx-auto flex w-fit items-center">
            <WonderIDLogo size={52} showTagline alt="" priority />
          </Link>

          <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-md)] sm:p-7">
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>

          <div className="mt-4 text-center text-xs text-muted-foreground">
            <Link href="/help" className="hover:text-foreground hover:underline">
              Need help?
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
