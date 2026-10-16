import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/session";
import { ArrowUpRight } from "lucide-react";
import { GUIDE_CATEGORIES, GUIDE_SECTIONS, WHATS_NEW, sectionsByCategory } from "@/modules/ui/help/content";
import { HelpAssistant } from "@/modules/ui/help/HelpAssistant";

export const metadata = {
  title: "Help",
  description: "User guide, FAQ and help assistant for WonderID.",
};

/**
 * The user guide and FAQ, reachable from the account menu's "Get Help".
 *
 * Content lives in `modules/ui/help/content.ts` rather than in this page so
 * the help assistant retrieves against exactly what is rendered here — one
 * source, so an answer can never link to a section that isn't on the page.
 *
 * Needs a session (owner request, 2026-10-16), checked here as well as in
 * the layout: a client-side navigation can fetch the page without its
 * layout. No module permission: it is product documentation with no
 * customer data.
 */

/** "16 Oct 2026" from a section's YYYY-MM-DD date, independent of the server's time zone. */
function lastUpdated(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function HelpPage() {
  if (!(await getSessionUser())) redirect("/sign-in?next=%2Fhelp");
  const faq = sectionsByCategory("FAQ");
  const guideCategories = GUIDE_CATEGORIES.filter((c) => c !== "FAQ");

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Get Help</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          How WonderID governs people, applications, access and AI agents, how to set it up, and
          answers to the questions that come up most. Ask the assistant below, or browse the guide.
        </p>
      </header>

      <HelpAssistant />

      <section aria-labelledby="whats-new" className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 id="whats-new" className="text-sm font-semibold text-foreground">
          What&rsquo;s new
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WHATS_NEW.map((item) => (
            <li key={item.id} className="min-w-0">
              <a href={`#${item.id}`} className="text-sm font-medium text-primary hover:underline">
                {item.label}
              </a>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <nav aria-label="Guide contents" className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-foreground">Contents</h2>
        <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDE_SECTIONS.map((s) => (
            <li key={s.id} className="min-w-0">
              <a
                href={`#${s.id}`}
                className="flex items-baseline gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground/70">
                  {s.category}
                </span>
                <span className="truncate text-foreground">{s.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {guideCategories.map((category) => {
        const sections = sectionsByCategory(category);
        if (sections.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {category}
            </h2>
            <div className="space-y-3">
              {sections.map((s) => (
                <article
                  key={s.id}
                  id={s.id}
                  className="scroll-mt-20 rounded-xl border border-border bg-card p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-foreground">{s.title}</h3>
                    {s.href && (
                      <Link
                        href={s.href}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Open in app
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.summary}</p>
                  <div className="mt-3 space-y-2">
                    {s.body.map((paragraph, i) => (
                      <p key={i} className="text-sm leading-relaxed text-foreground">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Last updated {lastUpdated(s.updated)}</p>
                  <p className="mt-3 text-xs text-muted-foreground">Last updated {lastUpdated(s.updated)}</p>
            </article>
              ))}
            </div>
          </section>
        );
      })}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Frequently asked
        </h2>
        <div className="space-y-3">
          {faq.map((s) => (
            <article
              key={s.id}
              id={s.id}
              className="scroll-mt-20 rounded-xl border border-border bg-card p-4 sm:p-5"
            >
              <h3 className="text-base font-semibold text-foreground">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.summary}</p>
              <div className="mt-3 space-y-2">
                {s.body.map((paragraph, i) => (
                  <p key={i} className="text-sm leading-relaxed text-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Last updated {lastUpdated(s.updated)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* The one contact route the product already has: the landing page's
          "Email us" link. As there, the address is only in the mailto: href,
          never printed, so it can't be read straight off the page text. */}
      <section aria-labelledby="still-need-help" className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 id="still-need-help" className="text-sm font-semibold text-foreground">
          Still need help?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          For access, roles and sign-in questions, start with your organization&rsquo;s administrator. To reach the WonderID team,{" "}
          <a href="mailto:connect@wonderapps.biz" className="font-medium text-primary hover:underline">
            email the WonderID team
          </a>
          .
        </p>
      </section>
    </div>
  );
}
