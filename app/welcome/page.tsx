import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Fingerprint,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { LinkButton } from "@/modules/ui";

export const metadata: Metadata = {
  title: "WonderAgent — Govern every AI agent. Verify every action.",
  description:
    "WonderAgent makes AI agents first-class enterprise identities: their owner, their approved purpose, the access they actually hold, and what they actually did — across the IAM platforms you already run.",
};

/**
 * EXPERIENCE-P0-14 — the public landing page. Served at `/` for signed-out
 * visitors via a rewrite in proxy.ts, so the marketing page and the
 * authenticated Overview can share the root path without colliding as two
 * route-group `page.tsx` files.
 *
 * Built entirely from the locked design system's tokens and `modules/ui`
 * primitives — no second styling approach, no gradient/neon/glassmorphism
 * (docs/design/UI-UX-DESIGN-RULES.md §5). The "machine" character comes
 * from precision instead of effects: a hairline grid, monospace for
 * machine-readable values, hairline borders, layered surfaces and small
 * status indicators. §11's SHOULD/CAN/DID model is the centrepiece,
 * rendered with the same vocabulary the product itself uses.
 */

const CAPABILITIES = [
  {
    icon: Fingerprint,
    title: "Agent identity & lifecycle",
    body: "Every agent gets an owner, a purpose and a lifecycle state — from discovered through retired — instead of living as an untracked service account.",
  },
  {
    icon: KeyRound,
    title: "Effective access (CAN)",
    body: "Resolve what an agent can technically reach today by walking real entitlements, roles, groups, OAuth scopes and tool permissions from your IAM.",
  },
  {
    icon: Activity,
    title: "Runtime assurance (DID)",
    body: "Observe what the agent actually did — every tool call, resource and action — and compare it against what it was approved to do.",
  },
  {
    icon: ShieldAlert,
    title: "Risk & rogue detection",
    body: "Deterministic scoring across excessive access, unauthorized resources, sensitive-data violations and behavioural deviation. Never an LLM guess.",
  },
  {
    icon: ClipboardCheck,
    title: "Certification & evidence",
    body: "Run access certification campaigns over agents, with a reproducible evidence snapshot behind every decision a reviewer makes.",
  },
  {
    icon: Boxes,
    title: "Works with your IAM",
    body: "Vendor-neutral by design. Saviynt, Okta, Entra, custom IAM and MCP runtimes map into one canonical model — your IAM stays the system of record.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Connect what you already run",
    body: "Import agent identities and their access from your existing IAM, plus runtime events from your MCP or REST sources. Read-only until you say otherwise.",
  },
  {
    n: "02",
    title: "Declare the agent's purpose",
    body: "Name an owner, the approved applications, the approved data and the approved actions. That contract becomes SHOULD.",
  },
  {
    n: "03",
    title: "Watch the three diverge",
    body: "WonderAgent continuously compares approved purpose, effective access and observed behaviour, and raises an evidence-backed finding the moment they stop agreeing.",
  },
  {
    n: "04",
    title: "Remediate through your workflow",
    body: "Recommended revocations route into the IAM workflow you already use, with human approval for anything consequential. Re-evaluated after the change lands.",
  },
] as const;

function GridBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]"
      style={{
        backgroundImage:
          "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
      }}
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">{children}</p>
  );
}

export default function WelcomePage() {
  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-border">
        <GridBackdrop />
        <div className="mx-auto max-w-5xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pb-24 sm:pt-24">
          <SectionLabel>AI Identity Governance &amp; Runtime Assurance</SectionLabel>

          <h1 className="mx-auto mt-5 max-w-4xl text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
            Govern every AI agent.{" "}
            <span className="block text-primary">Verify every action.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Your AI agents already hold real access to real systems. WonderAgent makes each one a
            first-class enterprise identity — with an owner, an approved purpose, the access it
            actually holds, and a record of what it actually did.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LinkButton href="/sign-up" size="lg" className="w-full rounded-full px-7 sm:w-auto">
              Get started
            </LinkButton>
            <LinkButton
              href="/sign-in"
              size="lg"
              variant="outline"
              className="w-full rounded-full px-7 sm:w-auto"
            >
              Sign in
            </LinkButton>
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Read-only to start. Your IAM stays the system of record.
          </p>
        </div>
      </section>

      {/* ------------------------------------------- SHOULD / CAN / DID */}
      <section id="model" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>The governance model</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Three answers that should agree — and usually don&rsquo;t.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Most teams can answer one of these. Governance needs all three, continuously, for
              every agent.
            </p>
          </div>

          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
            {[
              {
                key: "SHOULD",
                tone: "text-info",
                dot: "bg-info",
                q: "What is it approved to do?",
                body: "From the agent's contract: its owner, approved applications, approved data and approved actions.",
                value: "Financial reporting data · READ, REPORT",
              },
              {
                key: "CAN",
                tone: "text-warning",
                dot: "bg-warning",
                q: "What can it technically do?",
                body: "Effective access computed from your IAM — entitlements, roles, groups, scopes and tool permissions.",
                value: "SAP · Snowflake/Finance · Snowflake/CustomerDB",
              },
              {
                key: "DID",
                tone: "text-destructive",
                dot: "bg-destructive",
                q: "What did it actually do?",
                body: "Observed runtime behaviour, event by event, correlated back to the identity that performed it.",
                value: "READ Snowflake/CustomerDB · 03:14 UTC",
              },
            ].map((col) => (
              <div key={col.key} className="flex flex-col bg-card p-6">
                <div className="flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${col.dot}`} aria-hidden="true" />
                  <span
                    className={`font-mono text-xs font-semibold uppercase tracking-[0.18em] ${col.tone}`}
                  >
                    {col.key}
                  </span>
                </div>
                <p className="mt-3 text-base font-medium text-foreground">{col.q}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{col.body}</p>
                <p className="mt-5 break-words rounded-md border border-border bg-muted/60 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground md:mt-auto md:pt-2">
                  {col.value}
                </p>
              </div>
            ))}
          </div>

          {/* the finding that falls out of the divergence */}
          <div className="mt-6 overflow-hidden rounded-xl border border-destructive/30 bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-destructive">
                Critical
              </span>
              <span className="font-mono text-xs text-muted-foreground">excessive_access</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">FinanceBot</span>
            </div>
            <div className="grid gap-6 p-5 sm:grid-cols-[1.4fr_1fr]">
              <div>
                <p className="text-sm font-medium text-foreground">
                  CAN exceeds SHOULD, and DID confirms the gap was used.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  FinanceBot is approved for financial reporting data only, but holds an entitlement
                  to <span className="font-mono text-foreground">Snowflake/CustomerDB</span> — and
                  the runtime log shows it read from there. Evidence is attached to the finding, not
                  inferred after the fact.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Recommended
                </p>
                <p className="mt-2 text-sm text-foreground">
                  Revoke <span className="font-mono">CustomerDB</span> entitlement
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Routed to your IAM workflow. Human approval required. Finding re-evaluated once
                  the change lands.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- capabilities */}
      <section id="platform" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>The platform</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Identity governance built for non-human identities.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Not a replacement IAM, IGA, PAM or SIEM. A governance and assurance layer that sits
              over the ones you already run.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] transition-colors hover:border-primary/30"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- how it works */}
      <section id="how-it-works" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              From unknown agents to certified ones.
            </h2>
          </div>

          <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li key={step.n} className="bg-card p-6">
                <span className="font-mono text-xs font-semibold tracking-[0.18em] text-primary">
                  {step.n}
                </span>
                <h3 className="mt-3 text-base font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ----------------------------------------------------- closing CTA */}
      <section className="relative overflow-hidden">
        <GridBackdrop />
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-24">
          <ShieldCheck className="mx-auto size-8 text-primary" aria-hidden="true" />
          <h2 className="mt-5 text-balance text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
            Know what every agent should do, can do, and did.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Create your organization and register your first agent in minutes.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LinkButton href="/sign-up" size="lg" className="w-full rounded-full px-7 sm:w-auto">
              Get started
              <ArrowRight className="size-4" aria-hidden="true" />
            </LinkButton>
            <LinkButton
              href="/sign-in"
              size="lg"
              variant="outline"
              className="w-full rounded-full px-7 sm:w-auto"
            >
              Sign in
            </LinkButton>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-foreground">WonderAgent</span>
          </div>
          <p className="text-sm text-muted-foreground">
            AI Identity Governance &amp; Runtime Assurance
          </p>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/sign-in" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Link href="/sign-up" className="text-muted-foreground hover:text-foreground">
              Get started
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
