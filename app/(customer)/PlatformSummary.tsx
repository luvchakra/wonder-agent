import { countIdentitiesByType, countOpenLifecycleTasks } from "@/modules/agent-identity/service";
import { countPendingAccessRequests, getAccountSummary, getCatalogSummary } from "@/modules/access-governance/service";
import { countOpenAccessFindings } from "@/modules/risk/service";
import { campaignItemCounts } from "@/modules/certification-compliance/service";
import { KpiCard } from "@/modules/ui";

/**
 * The dashboard's platform summary (owner request, 2026-10-13: "a summary
 * for the entire platform, not just agents"): one card per area of
 * WonderID, each a database count (head counts or one aggregate, §15),
 * read as the member under RLS and shown only to a member who may open the
 * area. A count that cannot be read says "Unavailable" rather than a number
 * (§19.2). Streams in under its own Suspense boundary.
 */
type Card = { icon: string; label: string; value: string | number; footnote: string; href: string; tone: "primary" | "success" | "warning" | "danger" | "violet" | "neutral"; emphasis?: boolean };

const settle = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function PlatformSummary({ tenantId, permissions }: { tenantId: string; permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const [identities, lifecycle, apps, accounts, pending, rogue, reviews] = await Promise.all([
    can("identity.read") ? settle(countIdentitiesByType(tenantId)) : null,
    can("identity.read") ? settle(countOpenLifecycleTasks(tenantId)) : null,
    can("access.read") ? settle(getCatalogSummary(tenantId)) : null,
    can("access.read") ? settle(getAccountSummary(tenantId)) : null,
    can("access.read") ? settle(countPendingAccessRequests(tenantId)) : null,
    can("risk.read") ? settle(countOpenAccessFindings(tenantId)) : null,
    can("compliance.read") ? settle(campaignItemCounts(tenantId)) : null,
  ]);
  const unavailable = "Unavailable";
  const cards: Card[] = [];
  if (can("identity.read")) {
    const total = identities ? Object.values(identities).reduce((a, b) => a + b, 0) : null;
    cards.push({
      icon: "IdCard",
      tone: "primary",
      label: "Identities",
      value: total ?? unavailable,
      footnote: identities && total !== null ? `${identities.HUMAN ?? 0} people · ${identities.EXTERNAL ?? 0} external · ${total - (identities.HUMAN ?? 0) - (identities.EXTERNAL ?? 0)} non-human` : "Could not be counted",
      href: "/identities",
    });
    cards.push({ icon: "Clock", tone: "neutral", label: "Lifecycle work open", value: lifecycle ?? unavailable, footnote: "Joiner, mover and leaver tasks", href: "/identities/lifecycle" });
  }
  if (can("access.read")) {
    cards.push({ icon: "Box", tone: "success", label: "Live applications", value: apps?.active ?? unavailable, footnote: apps ? `${apps.onboarding} being onboarded` : "Could not be counted", href: "/access" });
    cards.push({ icon: "UserX", tone: "warning", label: "Orphaned accounts", value: accounts?.orphan ?? unavailable, footnote: accounts ? `of ${accounts.total} accounts` : "Could not be counted", href: "/access/accounts?view=orphan" });
    cards.push({ icon: "ClipboardList", tone: "violet", label: "Requests waiting", value: pending ?? unavailable, footnote: "Access requests to decide", href: "/access/requests?view=waiting" });
  }
  if (can("risk.read")) cards.push({ icon: "Siren", tone: "danger", emphasis: true, label: "Rogue accounts", value: rogue ?? unavailable, footnote: "Access nothing explains", href: "/risk/rogue-accounts" });
  if (can("compliance.read")) {
    let open = 0;
    let overdue = 0;
    for (const m of reviews?.values() ?? []) {
      open += m.pendingItems;
      overdue += m.overdueItems;
    }
    cards.push({ icon: "ShieldCheck", tone: "primary", label: "Review items open", value: reviews ? open : unavailable, footnote: reviews ? `${overdue} overdue` : "Could not be counted", href: "/compliance/campaigns" });
  }
  if (!cards.length) return null;
  return (
    <section aria-label="Platform summary" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {cards.map((c) => (
        <KpiCard key={c.label} size="sm" icon={c.icon} tone={c.tone} emphasis={c.emphasis} label={c.label} value={c.value} footnote={c.footnote} href={c.href} />
      ))}
    </section>
  );
}

/** The placeholder while the summary streams in (§15). */
export function PlatformSummarySkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-[88px] animate-pulse rounded-xl border border-border bg-muted/40" />
      ))}
    </div>
  );
}
