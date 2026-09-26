import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AppWindow,
  ArrowRight,
  ClipboardCheck,
  Fingerprint,
  Inbox,
  KeyRound,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { BrowserFrame, FlowDiagram, LinkButton, WonderIDLogo, PhoneFrame } from "@/modules/ui";
import agentsDesktopDark from "@/assets/product/agents-desktop-dark.png";
import agentsDesktopLight from "@/assets/product/agents-desktop-light.png";
import overviewDesktopDark from "@/assets/product/overview-desktop-dark.png";
import overviewDesktopLight from "@/assets/product/overview-desktop-light.png";
import overviewMobileDark from "@/assets/product/overview-mobile-dark.png";
import overviewMobileLight from "@/assets/product/overview-mobile-light.png";
import riskDesktopDark from "@/assets/product/risk-desktop-dark.png";
import riskDesktopLight from "@/assets/product/risk-desktop-light.png";

export const metadata: Metadata = {
  title: { absolute: "WonderID · Secure every identity. Human and AI." },
  description:
    "WonderID is one identity governance and security platform for people, external users, machine identities and AI agents: who holds access, why they hold it, who approved it, and whether it is still appropriate — across the IAM platforms you already run.",
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
    icon: Users,
    title: "One directory of identities",
    body: "Employees, contractors, external users, service accounts and AI agents in one place, fed by your authoritative sources, with joiner, mover and leaver work governed end to end.",
  },
  {
    icon: Fingerprint,
    title: "AI agent identity & contracts",
    body: "Every agent gets an accountable owner, an approved purpose and a lifecycle state — and shadow AI found in your systems lands in a discovery inbox instead of going unnoticed.",
  },
  {
    icon: AppWindow,
    title: "Applications & accounts",
    body: "An application catalog with a guided onboarding path, and an account inventory that correlates every account to an identity and flags the orphaned and dormant ones.",
  },
  {
    icon: Inbox,
    title: "Access requests & packages",
    body: "A self-service catalog, bundled access packages and staged approval chains with four-eyes enforced in the database — and separation-of-duties conflicts shown before anyone approves.",
  },
  {
    icon: KeyRound,
    title: "Effective Access (CAN)",
    body: "Resolve what an identity can technically reach today by walking real entitlements, roles, groups, OAuth scopes and tool permissions — with the path that grants each one.",
  },
  {
    icon: Activity,
    title: "Runtime assurance — Observed (DID)",
    body: "Observe every tool call, resource and action; decide in-line through the Runtime Gateway; and stop an agent instantly with audited emergency controls.",
  },
  {
    icon: ShieldAlert,
    title: "Risk, rogue detection & investigations",
    body: "Deterministic scoring across excessive access, unauthorized actions, sensitive data and behavioural deviation — with investigations to work a case to its conclusion. Never an LLM guess.",
  },
  {
    icon: ClipboardCheck,
    title: "Certification & evidence",
    body: "Access certification campaigns with a reproducible evidence snapshot behind every decision, audit trails and exportable reports ready for an auditor.",
  },
  {
    icon: UserCog,
    title: "Precise administration",
    body: "Users, groups, custom roles built from a published permission catalog, role assignments scoped by environment, application or agent, and explicit deny policies — nobody can grant themselves more.",
  },
] as const;

const WHATS_NEW = [
  {
    tag: "Authorization",
    title: "Scoped roles and explicit policies",
    body: "Limit a role to production, to chosen applications or agents, to a date range or to MFA sessions. Add deny or require-approval policies that override any role, with a break-glass exception.",
  },
  {
    tag: "Administration",
    title: "Users, groups and custom roles",
    body: "Invite and manage people through their whole membership lifecycle, give roles to groups, and design custom roles from the permission catalog — with self-escalation refused by design.",
  },
  {
    tag: "Access governance",
    title: "Requests, approvals and access packages",
    body: "A request catalog with policies, a staged approval engine with escalation and expiry, and access packages that assign bundles of access in one request.",
  },
  {
    tag: "Applications",
    title: "Catalog, onboarding and account inventory",
    body: "Onboard an application through configure, validate, simulate, approve and promote; discover the ones nobody registered; and find accounts that belong to nobody.",
  },
  {
    tag: "Identities",
    title: "Authoritative sources and lifecycle",
    body: "Import people from HR and directory sources with precedence and review of uncertain matches, then run joiner, mover and leaver work as governed tasks.",
  },
  {
    tag: "Your organization",
    title: "Your own sign-in address and brand",
    body: "Each organization signs in at its own address, sees its own name at the door, and keeps its data isolated in the database — never just in the application.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Connect what you already run",
    body: "Bring in people from your HR and directory sources, accounts and entitlements from your IAM and applications, and runtime events from MCP or REST sources. Read-only until you say otherwise.",
  },
  {
    n: "02",
    title: "Give every identity an owner",
    body: "Give each identity an owner and a lifecycle. For AI agents, declare the approved applications, data and actions — that contract becomes Approved (SHOULD).",
  },
  {
    n: "03",
    title: "Control how access is granted",
    body: "People request access from a catalog; approvals run in stages with four-eyes and separation of duties; roles, groups, scopes and policies decide who may administer what.",
  },
  {
    n: "04",
    title: "Detect, certify, remediate",
    body: "WonderID compares approved, effective and observed access, raises evidence-backed findings, runs certifications, and waits for a human to confirm every consequential change.",
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
          <SectionLabel>Identity Governance &amp; Security</SectionLabel>

          <h1 className="mx-auto mt-5 max-w-4xl text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
            Govern every identity.{" "}
            <span className="block text-primary">Verify every access.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            People, service accounts and AI agents all hold real access to real systems. WonderID
            makes each one a governed identity — starting with AI agents: an owner, an approved
            purpose, the access it actually holds, and a record of what it actually did.
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

      {/* ------------------------------------------------ product shot */}
      <section className="relative border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative -mt-10 pb-16 sm:-mt-14 sm:pb-20">
            <BrowserFrame
              light={overviewDesktopLight}
              dark={overviewDesktopDark}
              alt="The WonderID overview dashboard: agent counts, risk by severity, an action queue and recent findings for a tenant called Northwind Financial."
              priority
              sizes="(min-width: 1280px) 1100px, 100vw"
            />
            {/* The phone tucks into the corner on large screens and sits
                beneath the browser on small ones, so neither is ever cropped. */}
            <div className="mt-6 flex justify-center lg:mt-0 lg:absolute lg:-bottom-4 lg:-right-6 lg:block">
              <PhoneFrame
                light={overviewMobileLight}
                dark={overviewMobileDark}
                alt="The same overview on a phone, with the metric cards stacked two across."
                className="w-40 sm:w-48 lg:w-[220px]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- the problem */}
      <section id="problem" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>The problem</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              AI agents got production access. Nobody gave them an identity.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              An agent is provisioned like a service account, inherits access like a person, and
              acts continuously like neither. Your IAM records the credential. Nothing records the
              intent, the owner, or the behaviour — so the questions an auditor asks have no owner
              inside the business.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                q: "Who owns this agent?",
                a: "It was provisioned as SVC_FINANCEBOT_PRD by someone who has since changed teams. No business owner, no technical owner, nobody to approve a change to its access.",
              },
              {
                q: "What is it allowed to do?",
                a: "Its purpose lives in a ticket, a design doc, or somebody's memory — never anywhere a control can evaluate it. So \u201cis this access appropriate?\u201d has no answer.",
              },
              {
                q: "What did it actually do last night?",
                a: "Runtime logs sit in an observability tool keyed by service name, disconnected from the identity, the entitlement and the approval that allowed it.",
              },
            ].map((item) => (
              <div key={item.q} className="rounded-xl border border-border bg-card p-5">
                <p className="text-base font-semibold text-foreground">{item.q}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 max-w-3xl border-l-2 border-destructive/40 pl-4 text-base leading-relaxed text-foreground">
            The gap is not that agents are dangerous. It is that{" "}
            <span className="font-semibold">nothing compares what an agent was approved to do
            against what it can reach and what it actually did</span> — so excessive access is only
            discovered after it has been used.
          </p>
        </div>
      </section>

      {/* ------------------------------------------- SHOULD / CAN / DID */}
      <section id="model" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>The solution</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Close the gap by holding all three answers at once.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              WonderID keeps an agent&rsquo;s approved purpose, its effective access and its
              observed behaviour side by side, and treats any divergence between them as a finding
              with evidence attached.
            </p>
          </div>

          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
            {[
              {
                key: "Approved (SHOULD)",
                tone: "text-info",
                dot: "bg-info",
                q: "What is it approved to do?",
                body: "From the agent's contract: its owner, approved applications, approved data and approved actions.",
                value: "Financial reporting data · READ, REPORT",
              },
              {
                key: "Effective Access (CAN)",
                tone: "text-warning",
                dot: "bg-warning",
                q: "What can it technically do?",
                body: "Effective access computed from your IAM — entitlements, roles, groups, scopes and tool permissions.",
                value: "SAP · Snowflake/Finance · Snowflake/CustomerDB",
              },
              {
                key: "Observed (DID)",
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
                  Effective Access (CAN) exceeds Approved (SHOULD), and Observed (DID) confirms the gap was used.
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
                  Applied only after a human confirms, and the finding is re-evaluated
                  once the access actually changes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ the flow, moving */}
      {/* overflow-hidden: the comparison node's pulse ring scales past its
          own box, and at phone widths that box already spans the viewport. */}
      <section className="overflow-hidden border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>How the evaluation runs</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              One pipeline, running continuously.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Contract, entitlements and runtime events flow into the same deterministic comparison.
              No model decides whether access is appropriate — the rules do, and the evidence is
              kept.
            </p>
          </div>
          <div className="mt-10">
            <FlowDiagram />
          </div>
        </div>
      </section>

      {/* --------------------------------------------- inside the product */}
      <section id="product" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>Inside the product</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Built for the person who has to answer for it.
            </h2>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <div>
              <BrowserFrame
                light={riskDesktopLight}
                dark={riskDesktopDark}
                alt="The Risk screen listing every agent with open findings, worst severity first — FinanceBot critical, ProcurementCopilot high, SupportTriageBot medium."
                label="agent.WonderApps.biz/risk"
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
              <h3 className="mt-5 text-base font-semibold text-foreground">
                Risk, ordered by what to do first
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Every agent with an open finding, worst severity first, each one tracing back to the
                entitlement and the runtime event that produced it.
              </p>
            </div>

            <div>
              <BrowserFrame
                light={agentsDesktopLight}
                dark={agentsDesktopDark}
                alt="The AI Agents inventory listing FinanceBot, SupportTriageBot, InvoiceReconciler, ProcurementCopilot and DataQualityAgent with lifecycle state, criticality and owner."
                label="agent.WonderApps.biz/agents"
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
              <h3 className="mt-5 text-base font-semibold text-foreground">
                An inventory that is actually governed
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Lifecycle state, criticality and accountable owner on every agent — so an unowned
                agent in production is a visible exception, not a silent one.
              </p>
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
              One control plane for every identity — human, machine and AI.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              WonderID governs identities and access. It is not an identity provider, a PAM vault or
              a SIEM: your IdP still signs people in, and your HR and directory systems stay the
              system of record for what they own. Saviynt, Entra, Okta, custom IAM, REST sources
              and MCP runtimes all map into one vendor-neutral model.
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

      {/* ------------------------------------------------------ what's new */}
      <section id="whats-new" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>What&rsquo;s new</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Recently shipped.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              WonderID started with AI agents. It now governs people, applications and access
              requests too — with the same deterministic controls underneath.
            </p>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHATS_NEW.map((item) => (
              <li key={item.title} className="rounded-xl border border-border bg-card p-5">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{item.tag}</p>
                <h3 className="mt-2 text-base font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ----------------------------------------------------- how it works */}
      <section id="how-it-works" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              From unknown identities to certified access.
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
            Know who and what has access, why — and whether it still should.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Create your organization, invite your team and connect your first source in minutes.
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
          <WonderIDLogo size={26} />
          <p className="text-sm text-muted-foreground">
            Identity Governance &amp; Security · Govern every identity. Verify every access.
          </p>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/help" className="text-muted-foreground hover:text-foreground">
              Help
            </Link>
            <Link href="/sign-in" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Link href="/sign-up" className="text-muted-foreground hover:text-foreground">
              Get started
            </Link>
            {/* The address itself is deliberately never printed on the page —
                the mailto: link is the only place it lives, so it can't be
                scraped straight off the rendered HTML. */}
            <LinkButton
              href="mailto:connect@wonderapps.biz"
              variant="outline"
              size="sm"
              className="rounded-full"
            >
              <Mail className="size-3.5" aria-hidden="true" />
              Email us
            </LinkButton>
          </div>
        </div>
      </footer>
    </>
  );
}
