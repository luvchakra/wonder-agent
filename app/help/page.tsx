import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { GUIDE_CATEGORIES, GUIDE_SECTIONS, sectionsByCategory } from "@/modules/ui/help/content";
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
 * Needs no permission of its own: it is product documentation, identical
 * for every tenant, and contains no customer data.
 */
/** The latest additions, each pointing at the guide section that explains it. */
const WHATS_NEW = [
  { id: "authorization-policies", label: "Authorization policies", note: "Deny or require approval for any permission, with break-glass roles." },
  { id: "scoped-assignments", label: "Scoped and time-limited roles", note: "Limit a role to an environment, application or agent, dates or MFA." },
  { id: "groups", label: "Groups", note: "Give roles to a whole team at once." },
  { id: "users", label: "Users and custom roles", note: "Invite, suspend and remove people; design roles from the permission catalog." },
  { id: "access-requests", label: "Access requests and approvals", note: "A request catalog with staged, four-eyes approvals and SoD checks." },
  { id: "applications", label: "Application onboarding and accounts", note: "Onboard apps step by step; find orphaned and dormant accounts." },
] as const;

export default function HelpPage() {
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
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
