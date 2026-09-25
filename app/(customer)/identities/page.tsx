import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { countIdentitiesByType, getIdentityHealth } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, CardHeader, KpiCard, LinkButton } from "@/modules/ui";

// IDENTITY-P0-17 — the Identities overview: how many identities of each
// kind the organization governs, and the gaps that need someone's
// attention. Every number links to the list behind it.

export default async function IdentitiesOverviewPage() {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const [counts, health] = await Promise.all([countIdentitiesByType(ctx.tenantId!), getIdentityHealth(ctx.tenantId!)]);
  const machines = counts.SERVICE_ACCOUNT + counts.APPLICATION + counts.WORKLOAD + counts.API + counts.MACHINE;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const canManage = ctx.permissions.includes("identity.manage");

  const attention = [
    {
      label: "Machine identities without an owner",
      value: health.machinesWithoutOwner,
      href: "/identities/machines",
      help: "Every service account, workload and API client needs an accountable person.",
    },
    {
      label: "External access ending within 30 days",
      value: health.externalsExpiringSoon,
      href: "/identities/external?status=active",
      help: "Extend with the sponsor's agreement, or let it end.",
    },
    {
      label: "External identities past their end date",
      value: health.externalsExpired,
      href: "/identities/external?status=active",
      help: "Still active after the end date: disable them or extend the date.",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Identities</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every identity this organization governs: people, external users, machine identities and AI agents, in one directory. Your
            identity providers stay the system of record for sign-in; WonderID records ownership, sponsorship and relationships.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/identities/all" variant="outline" size="sm">
            Browse all
          </LinkButton>
          {canManage ? (
            <LinkButton href="/identities/new" size="sm">
              New identity
            </LinkButton>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard size="sm" icon="Fingerprint" tone="primary" label="All identities" value={total} href="/identities/all" />
        <KpiCard size="sm" icon="Users" tone="success" label="People" value={counts.HUMAN} href="/identities/humans" />
        <KpiCard size="sm" icon="Globe" tone="warning" label="External" value={counts.EXTERNAL} href="/identities/external" />
        <KpiCard size="sm" icon="Server" tone="neutral" label="Machine" value={machines} href="/identities/machines" />
        <KpiCard size="sm" icon="Bot" tone="violet" label="AI agents" value={counts.AI_AGENT} href="/agents" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Needs attention" description="Gaps in accountability, counted live from the directory." />
          <CardBody>
            <ul className="divide-y divide-border">
              {attention.map((a) => (
                <li key={a.label} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link href={a.href} className="text-sm font-medium text-foreground hover:underline">
                      {a.label}
                    </Link>
                    <p className="text-xs text-muted-foreground">{a.help}</p>
                  </div>
                  <span className={`shrink-0 text-lg font-semibold tabular-nums ${a.value > 0 ? "text-warning" : "text-muted-foreground"}`}>{a.value}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Machine identities by kind" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {(
                [
                  ["Service accounts", counts.SERVICE_ACCOUNT],
                  ["Application accounts", counts.APPLICATION],
                  ["Workloads", counts.WORKLOAD],
                  ["API clients", counts.API],
                  ["Machines", counts.MACHINE],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums text-foreground">{n}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Identities your connected sources report but nobody has registered yet are in{" "}
              <Link href="/agents/identities" className="text-primary hover:underline">
                Non-human identities
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
