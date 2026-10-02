import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AppWindow,
  ArrowRight,
  BadgeCheck,
  Bot,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Cpu,
  FileLock2,
  Fingerprint,
  Handshake,
  History,
  Inbox,
  KeyRound,
  Landmark,
  Lock,
  Mail,
  Network,
  Scale,
  ScrollText,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
  Siren,
  UserCheck,
  UserRound,
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
  title: { absolute: "WonderID · Identity governance for human and non-human identities" },
  description:
    "WonderID is identity governance and administration (IGA) for human and non-human identities: employees, contractors, partners, service accounts, workloads, API keys and AI agents. One control plane for lifecycle, access requests, certification, risk and runtime assurance, with security, privacy (GDPR, DPDP) and financial compliance (SOX) built in.",
};

/**
 * EXPERIENCE-P0-14 — the public landing page. Served at `/` for signed-out
 * visitors via a rewrite in proxy.ts, so the marketing page and the
 * authenticated Overview can share the root path without colliding as two
 * route-group `page.tsx` files.
 *
 * Positioning (2026-10-01, user request): IGA for human and non-human
 * identities, with every shipped feature and the security, privacy and
 * compliance controls built into the product. Every claim on this page maps
 * to something that exists in the product; control mappings are described
 * as evidence for auditors, never as a certification (CLAUDE.md §10 item 10).
 *
 * Built entirely from the locked design system's tokens and `modules/ui`
 * primitives — no second styling approach, no gradient/neon/glassmorphism
 * (docs/design/UI-UX-DESIGN-RULES.md §5). The "machine" character comes
 * from precision instead of effects: a hairline grid, monospace for
 * machine-readable values, hairline borders, layered surfaces and small
 * status indicators. §11's SHOULD/CAN/DID model is the centrepiece,
 * rendered with the same vocabulary the product itself uses.
 */

const IDENTITY_TYPES = [
  {
    icon: UserRound,
    kind: "Human",
    title: "Workforce",
    examples: "Employees · contractors · interns",
    body: "Imported from your HR and directory sources with precedence rules and review of uncertain matches. Joiner, mover and leaver changes run as governed tasks with approvals.",
  },
  {
    icon: Handshake,
    kind: "Human",
    title: "External identities",
    examples: "Partners · vendors · customers",
    body: "Every external identity has an accountable internal owner. They are reviewed in the same certification campaigns as employees, so access never outlives the relationship.",
  },
  {
    icon: ServerCog,
    kind: "Non-human",
    title: "Machine identities",
    examples: "Service accounts · workloads · API keys",
    body: "Linked to the applications and accounts they run under, given an owner, and flagged when orphaned or dormant. Credentials are governed for ownership and expiry, never stored.",
  },
  {
    icon: Bot,
    kind: "Non-human",
    title: "AI agents",
    examples: "Agents · copilots · MCP tools",
    body: "Each agent has a contract of approved purpose, applications, data and actions. It is observed at runtime and can be stopped instantly with audited emergency controls.",
  },
] as const;

const LIFECYCLE = ["Discover", "Onboard", "Request", "Approve", "Certify", "Detect", "Remediate", "Offboard"] as const;

const FEATURE_GROUPS = [
  {
    icon: Users,
    title: "Identity lifecycle",
    points: [
      "One directory for people, external, machine and AI identities",
      "Authoritative HR and directory sources with precedence",
      "Joiner, mover and leaver work as governed tasks",
      "Identity attributes you define",
    ],
  },
  {
    icon: AppWindow,
    title: "Applications & accounts",
    points: [
      "Application catalog with configure, validate, simulate, approve and promote onboarding",
      "Discovery of unregistered applications and shadow AI",
      "Every account matched to its identity",
      "Orphaned and dormant accounts flagged",
    ],
  },
  {
    icon: Inbox,
    title: "Access requests",
    points: [
      "Self-service catalog and access packages",
      "Staged approvals with escalation and expiry",
      "Four-eyes enforced in the database",
      "Separation-of-duties conflicts shown before approval",
    ],
  },
  {
    icon: KeyRound,
    title: "Effective access",
    points: [
      "Entitlements, roles, groups, OAuth scopes and tool permissions resolved",
      "The access path behind every grant",
      "Saviynt, Entra, Okta, custom IAM, REST and MCP in one vendor-neutral model",
    ],
  },
  {
    icon: ClipboardCheck,
    title: "Certification",
    points: [
      "Campaigns across every identity type",
      "A reproducible evidence snapshot behind each decision",
      "Revocations go through human-approved remediation",
      "Evidence exports ready for auditors",
    ],
  },
  {
    icon: Scale,
    title: "Policy & administration",
    points: [
      "Governance and request policies",
      "Custom roles built from a published permission catalog",
      "Role assignments scoped by environment, application, agent, dates or MFA",
      "Deny and require-approval policies with break-glass",
    ],
  },
  {
    icon: ShieldAlert,
    title: "Risk & detection",
    points: [
      "Deterministic risk scoring for every identity type",
      "Excessive access, unauthorized actions and sensitive data",
      "Behavioural deviation and rogue agent detection",
      "Investigations worked to a conclusion",
    ],
  },
  {
    icon: Activity,
    title: "Runtime assurance",
    points: [
      "A timeline of every tool call, resource and action",
      "Runtime Gateway ALLOW / DENY, in observe or enforce mode",
      "Kill switch, tool suspension and key revocation",
      "Agent API keys stored only as hashes, with expiry",
    ],
  },
  {
    icon: ScrollText,
    title: "Insights & operations",
    points: [
      "Reports, exports and a searchable audit trail",
      "Notifications for approvals, findings and deadlines",
      "AI summaries that only advise, using your own provider key if you prefer",
    ],
  },
] as const;

const SECURITY = [
  {
    icon: Lock,
    title: "Tenant isolation in the database",
    body: "Every customer table carries a tenant id protected by PostgreSQL row-level security. Your organization is identified from your signed-in session, never from anything the browser sends.",
  },
  {
    icon: Cpu,
    title: "Rules decide, not AI",
    body: "Authorization, risk, policy and remediation are decided by rules you can read. AI drafts summaries and proposals but never makes a decision, and imported content cannot instruct it.",
  },
  {
    icon: UserCheck,
    title: "A person approves consequential change",
    body: "Grants, revocations, overrides and destructive remediation wait for a person to approve them. The database enforces four-eyes and separation of duties, not just the UI.",
  },
  {
    icon: History,
    title: "Tamper-evident audit trail",
    body: "Every security-sensitive action records the actor, target, outcome and correlation id. Entries are append-only and SHA-256 hash-chained per organization, and the chain can be verified in the product.",
  },
  {
    icon: Fingerprint,
    title: "Strong authentication",
    body: "SAML and OIDC single sign-on, Google, Microsoft and LinkedIn sign-in, authenticator-app MFA and idle and absolute session limits. Signing out ends every session.",
  },
  {
    icon: KeyRound,
    title: "Secrets never exposed",
    body: "Integration credentials are encrypted with AES-256-GCM under rotatable keys. They never reach the browser or the logs. Agent API keys are kept only as hashes.",
  },
  {
    icon: Network,
    title: "Read-only connectors by default",
    body: "Connectors declare what they can do, and a read-only connector never writes. Remediation runs through your own IAM workflow, and only after approval.",
  },
  {
    icon: Siren,
    title: "Runtime containment",
    body: "The Runtime Gateway allows or denies agent actions as they happen. In one audited step, a kill switch stops an agent, suspends its tools or revokes its keys.",
  },
  {
    icon: ShieldHalf,
    title: "Hardened web and supply chain",
    body: "HSTS preload, a strict content security policy and cross-site request blocking. Every change runs type checks, tests, a dependency audit and a secret scan.",
  },
] as const;

const TRUST = [
  {
    icon: FileLock2,
    tag: "Privacy",
    title: "GDPR and India DPDP built in",
    body: "Handle data-subject and data-principal rights within their legal deadlines, keep records of processing, and prove consent for every person whose identity data you govern.",
    points: [
      "Access, correction, erasure, grievance and nomination requests with legal deadlines",
      "One-click data export and consent withdrawal for every member",
      "Breach register with the 72-hour GDPR and DPDP Board clocks",
      "Retention schedules, legal holds and four-eyes erasure",
    ],
  },
  {
    icon: Landmark,
    tag: "Financial compliance",
    title: "SOX-ready evidence",
    body: "Access reviews, separation of duties and approvals become evidence your auditors can rely on, kept in an audit trail nobody can quietly edit.",
    points: [
      "Tamper-evident audit trail: append-only and SHA-256 hash-chained",
      "Control libraries for SOX ITGC, SOC 1, PCI DSS, GLBA, DORA, RBI, SEBI CSCRF and CERT-In",
      "Maker-checker on access and on financial adjustments",
      "Seven-year audit retention on Enterprise",
    ],
  },
  {
    icon: BadgeCheck,
    tag: "Security & AI governance",
    title: "Mapped to the frameworks you report on",
    body: "Certification decisions, policies and audit evidence map to security and AI governance controls, so one review answers several frameworks at once.",
    points: [
      "ISO/IEC 27001 and SOC 2 access-control evidence",
      "ISO/IEC 42001 and NIST AI RMF for AI agent governance",
      "NIST CSF identity and access outcomes",
      "Evidence snapshots that reproduce exactly what a reviewer saw",
    ],
  },
  {
    icon: CreditCard,
    tag: "Payments",
    title: "Stripe and Razorpay billing",
    body: "Upgrade, renew and cancel in the product. Cards, UPI and net banking are entered only on Stripe's or Razorpay's hosted pages, so WonderID never touches payment data (PCI DSS SAQ-A).",
    points: [
      "INR through Razorpay with RBI e-mandates; USD and EUR through Stripe",
      "Signed, replay-protected and idempotent webhooks",
      "GST-ready invoices: GSTIN validation, CGST/SGST or IGST, consecutive numbering",
      "Refunds and plan overrides need a second approver",
    ],
  },
] as const;

const FRAMEWORKS = [
  "GDPR",
  "UK GDPR",
  "India DPDP",
  "SOX ITGC",
  "SOC 1",
  "SOC 2",
  "ISO/IEC 27001",
  "ISO/IEC 42001",
  "NIST CSF",
  "NIST AI RMF",
  "PCI DSS",
  "GLBA",
  "EU DORA",
  "RBI",
  "SEBI CSCRF",
  "CERT-In",
] as const;

const WHATS_NEW = [
  {
    tag: "Billing",
    title: "Pay with Stripe or Razorpay",
    body: "Choose a plan, pay on the provider's secure page, and download GST-ready invoices. Cancel any time, effective at the end of the paid period.",
  },
  {
    tag: "Privacy",
    title: "GDPR and DPDP privacy centre",
    body: "Rights requests within their legal deadlines, records of processing, consent, retention, legal holds and a breach register, plus a My privacy page for every member.",
  },
  {
    tag: "Assurance",
    title: "Tamper-evident audit trail",
    body: "Audit entries are append-only and hash-chained. Audit Integrity proves nothing was altered, and financial control libraries cover SOX, PCI DSS and more.",
  },
  {
    tag: "Authorization",
    title: "Scoped roles and explicit policies",
    body: "Limit a role to production, to chosen applications or agents, to a date range or to MFA sessions. Add deny or require-approval policies that override any role, with a break-glass exception.",
  },
  {
    tag: "Access governance",
    title: "Requests, approvals and access packages",
    body: "A request catalog with policies, a staged approval engine with escalation and expiry, and access packages that assign bundles of access in one request.",
  },
  {
    tag: "Identities",
    title: "Authoritative sources and lifecycle",
    body: "Import people from HR and directory sources with precedence and review of uncertain matches, then run joiner, mover and leaver work as governed tasks.",
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
    body: "People, external users, service accounts and agents each get an accountable owner and a lifecycle. For AI agents, the approved applications, data and actions become Approved (SHOULD).",
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
          <SectionLabel>Identity Governance &amp; Administration</SectionLabel>

          <h1 className="mx-auto mt-5 max-w-4xl text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
            Govern every identity.{" "}
            <span className="block text-primary">Verify every access.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            WonderID is IGA for{" "}
            <span className="font-medium text-foreground">human and non-human identities</span>.
            Employees, contractors, partners, service accounts, workloads, API keys and AI agents
            share one governed directory. Each identity has an owner, a lifecycle, access it can
            justify and a record of how that access was used. Security, privacy and compliance are
            built in, not bolted on.
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
            Read-only to start. Your IdP and HR systems stay the system of record.
          </p>

          <ul aria-label="Identities governed" className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
            {IDENTITY_TYPES.map(({ icon: Icon, title, kind }) => (
              <li key={title} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
                <Icon className="size-3.5 text-primary" aria-hidden="true" />
                {title}
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{kind}</span>
              </li>
            ))}
          </ul>

          <ul aria-label="Compliance highlights" className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-2">
            {["GDPR", "India DPDP", "SOX ITGC", "SOC 2", "ISO 27001", "PCI DSS SAQ-A", "Tamper-evident audit"].map((label) => (
              <li key={label} className="rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </li>
            ))}
          </ul>
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

      {/* ------------------------------------- human and non-human identities */}
      <section id="identities" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>Human and non-human identities</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              One IGA for every identity your business runs on.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Anything that can receive, use, delegate, inherit or lose access is an identity. So
              WonderID governs people and non-people with the same lifecycle, the same approvals,
              the same certifications and the same audit trail. You don&rsquo;t run a second tool
              for service accounts or a third for AI.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {IDENTITY_TYPES.map(({ icon: Icon, kind, title, examples, body }) => (
              <div key={title} className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {kind}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-1 font-mono text-[11px] text-primary">{examples}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-border bg-card/60 p-5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              One lifecycle for every identity type
            </p>
            <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {LIFECYCLE.map((stage, i) => (
                <li key={stage} className="flex items-center gap-1.5">
                  <span className="rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium text-foreground">
                    {stage}
                  </span>
                  {i < LIFECYCLE.length - 1 ? (
                    <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- the problem */}
      <section id="problem" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>The problem</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Access outgrew the identities it was designed for.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Classic IGA was built for employees. Today much of your production access belongs to
              contractors, partners, service accounts and AI agents that act continuously. Your IAM
              records the credential. Nothing records the owner, the reason or the behaviour, so
              the questions an auditor asks have no answer inside the business.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                q: "Who owns this service account?",
                a: "It was provisioned as SVC_FINANCEBOT_PRD by someone who has since changed teams. No business owner, no technical owner, nobody to approve a change to its access.",
              },
              {
                q: "Why does this contractor still have access?",
                a: "The contract ended in March. HR closed the record, but the SAP account, the Snowflake role and the shared group membership stayed open.",
              },
              {
                q: "What did this agent do last night?",
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
            The gap is not that any one identity is dangerous. It is that{" "}
            <span className="font-semibold">nothing ties each identity to an owner, a reason for
            every grant and evidence of how the access was used</span>. So excessive access is only
            discovered after it has been used.
          </p>
        </div>
      </section>

      {/* ------------------------------------------- SHOULD / CAN / DID */}
      <section id="model" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>Beyond classic IGA</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Close the gap by holding all three answers at once.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Classic IGA stops at who has access. Non-human identities act on their own, so for
              them WonderID also compares three things: approved purpose, effective access and
              observed behaviour. Any divergence becomes a finding with evidence attached.
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
      <section className="overflow-hidden border-b border-border bg-card/40">
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
      <section id="product" className="border-b border-border">
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
      <section id="platform" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>The platform</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Every IGA capability, in one control plane.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Lifecycle, requests, certification, policy, risk and runtime assurance run on one
              identity model. WonderID governs identities and access. It is not an identity
              provider, a PAM vault or a SIEM: your IdP still signs people in, and your HR and
              directory systems stay the system of record for what they own.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GROUPS.map(({ icon: Icon, title, points }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] transition-colors hover:border-primary/30"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <h3 className="text-base font-semibold text-foreground">{title}</h3>
                </div>
                <ul className="mt-4 space-y-2">
                  {points.map((point) => (
                    <li key={point} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ security */}
      <section id="security" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>Security by design</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Security is the architecture, not a feature.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              A governance platform holds the map of who can reach what, so it has to be the hardest
              system in the estate to misuse. These controls are enforced in the database and the
              server. None of them is a UI-only check or a setting someone forgot to turn on.
            </p>
          </div>

          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-card p-6">
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <h3 className="mt-3 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- trust & compliance */}
      <section id="trust" className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <SectionLabel>Privacy &amp; compliance</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              Privacy and compliance, built into the product.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Privacy law, financial controls, security frameworks and payments are part of the
              product, not an add-on. WonderID gives you the controls and the evidence; your
              auditors and regulators decide compliance.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {TRUST.map(({ icon: Icon, tag, title, body, points }) => (
              <div key={title} className="flex flex-col rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{tag}</p>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                <ul className="mt-4 space-y-2">
                  {points.map((point) => (
                    <li key={point} className="flex gap-2 text-sm text-foreground">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-border bg-card p-6">
            <h3 className="text-base font-semibold text-foreground">Control libraries included</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Map certifications, policies and audit evidence to the frameworks you report against.
            </p>
            <ul aria-label="Control frameworks" className="mt-4 flex flex-wrap gap-2">
              {FRAMEWORKS.map((name) => (
                <li key={name} className="rounded-md border border-border bg-muted/60 px-2.5 py-1 font-mono text-xs text-foreground">
                  {name}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Control mappings and evidence support your auditors. They are not a certification,
              and using WonderID does not by itself make an organization compliant with any
              framework.
            </p>
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
              WonderID started with AI agents. It now governs people, external users, machine
              identities, applications and access requests too, with the same deterministic
              controls underneath.
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
            IGA for human and non-human identities · Govern every identity. Verify every access.
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
