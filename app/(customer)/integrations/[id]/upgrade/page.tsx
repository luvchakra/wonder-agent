import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { previewConnectionUpgrade } from "@/modules/integrations/framework/catalog";
import type { UpgradeArea } from "@/modules/integrations/framework/upgrade";
import { upgradeConnectionAction } from "@/app/actions/integrations";
import { Card, CardBody, CardHeader, PendingSubmitButton } from "@/modules/ui";

const AREA: Record<UpgradeArea, string> = {
  settings: "Settings",
  "sign-in": "Sign-in",
  reads: "What it reads",
  mapping: "How fields are mapped",
  writes: "Changes in the system",
  receives: "What it receives",
};

/**
 * INTEGRATION-P0-21: what moving a connection to another version of its
 * connection type changes, before it happens. One action: Upgrade.
 */
export default async function UpgradeConnectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string; failed?: string }> }) {
  const { id } = await params;
  const { version, failed } = await searchParams;
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !version) notFound();
  let plan;
  try {
    plan = await previewConnectionUpgrade(ctx.tenantId!, id, version);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  const canEdit = ctx.permissions.includes("integration.update");
  const areas = (Object.keys(AREA) as UpgradeArea[]).filter((a) => plan.changes.some((c) => c.area === a));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/integrations/${id}`} className="text-sm text-primary hover:underline">
        ← Connection
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Upgrade to v{plan.to}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.name}, now v{plan.from}. The next sync reads everything again with this version.
        </p>
      </div>

      {plan.blockers.length || failed ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          <p className="font-medium">This upgrade cannot run yet.</p>
          <ul className="mt-1 list-disc pl-5">
            {(plan.blockers.length ? plan.blockers : ["Something changed since this page loaded. Check the changes again."]).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardHeader title="What changes" />
        <CardBody>
          {areas.length ? (
            <dl className="space-y-3 text-sm">
              {areas.map((a) => (
                <div key={a}>
                  <dt className="text-muted-foreground">{AREA[a]}</dt>
                  <dd>
                    <ul className="mt-0.5 list-disc pl-5 text-foreground">
                      {plan.changes
                        .filter((c) => c.area === a)
                        .map((c) => (
                          <li key={c.text}>{c.text}</li>
                        ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing this connection uses changes.</p>
          )}
        </CardBody>
      </Card>

      {canEdit && !plan.blockers.length ? (
        <form action={upgradeConnectionAction.bind(null, id, plan.to)}>
          <PendingSubmitButton pendingLabel="Upgrading…">Upgrade</PendingSubmitButton>
        </form>
      ) : null}
    </div>
  );
}
