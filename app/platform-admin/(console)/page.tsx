import Link from "next/link";
import { listTenants, getPlatformHealth } from "@/modules/platform-admin/service";
import { Card, CardHeader, StatCard } from "@/modules/ui";
import { HealthSignals, PageHeading } from "@/app/platform-admin/PageHeading";

// Not statically analyzable as dynamic (the requirePlatformAdmin() auth
// check lives in the enclosing layout, not this page) — force it, or a
// production build attempts to prerender this page at build time and
// fails outside of a request context.
export const dynamic = "force-dynamic";

export default async function PlatformOverviewPage() {
  const [tenants, health] = await Promise.all([listTenants(), getPlatformHealth()]);
  const count = (status: string) => tenants.filter((t) => (t.status ?? "active") === status).length;

  return (
    <>
      <PageHeading title="Platform Overview" description="Every organization on WonderID and how the platform is running." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Organizations" value={tenants.length} href="/platform-admin/tenants" />
        <StatCard label="Active" value={count("active")} />
        <StatCard label="Suspended" value={count("suspended")} tone={count("suspended") > 0 ? "warning" : "neutral"} />
      </div>
      <Card>
        <CardHeader
          title="Health"
          actions={
            <Link href="/platform-admin/health" className="text-xs font-medium text-primary hover:underline">
              Details
            </Link>
          }
        />
        <HealthSignals health={health} />
      </Card>
    </>
  );
}
