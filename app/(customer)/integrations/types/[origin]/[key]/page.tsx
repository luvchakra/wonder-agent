import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getConnectorDefinition } from "@/modules/integrations/framework/catalog";
import { connectionTypeHref, describeConnectionType } from "@/modules/integrations/framework/typeSummary";
import { Badge, Card, CardBody, CardHeader, LinkButton } from "@/modules/ui";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const none = <span className="text-muted-foreground">Nothing</span>;

/** One connection type and its protocol details. Its one action creates a connection with it. */
export default async function ConnectionTypePage({ params }: { params: Promise<{ origin: string; key: string }> }) {
  const { origin, key } = await params;
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  if (origin !== "builtin" && origin !== "custom") notFound();
  const def = await getConnectorDefinition(ctx.tenantId!, origin, key);
  if (!def) notFound();
  const t = describeConnectionType(def, origin);
  // Authentication, pagination and rate limit describe the requests WonderID makes; a receive-only type makes none.
  const reads = t.reads.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/integrations/types" className="text-sm text-primary hover:underline">
        ← Connection types
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{t.name}</h1>
            <Badge tone={t.origin === "custom" ? "info" : "neutral"}>{t.originLabel}</Badge>
            <Badge tone="neutral">v{t.version}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
        </div>
        <LinkButton href={`${connectionTypeHref(t.origin, t.key)}/connect`} className="shrink-0">
          Create connection
        </LinkButton>
      </div>

      <Card>
        <CardHeader title="Protocol" />
        <CardBody>
          <dl className="divide-y divide-border">
            <Row label="Protocol">{t.protocol}</Row>
            {reads ? (
              <>
                <Row label="Authentication">
                  {t.auth.label}
                  {t.auth.carrier ? (
                    <>
                      {" "}
                      (<code className="font-mono text-xs">{t.auth.carrier}</code>)
                    </>
                  ) : null}
                  {t.auth.fields.length ? <span className="block text-muted-foreground">You enter: {t.auth.fields.join(", ")}</span> : null}
                </Row>
                <Row label="Pagination">{t.pagination.join(", ")}</Row>
                <Row label="Rate limit">{t.rateLimitPerSecond} requests per second</Row>
              </>
            ) : null}
            {t.settings.length ? <Row label="Settings">{t.settings.join(", ")}</Row> : null}
            <Row label="Reads">{reads ? t.reads.map((r) => r.label).join(", ") : none}</Row>
            <Row label="Receives">
              {t.receives.length
                ? t.receives.map((r) => (
                    <span key={r.channel} className="block py-0.5">
                      {r.label}
                      {r.paths.map((path) => (
                        <code key={path} className="block font-mono text-xs text-muted-foreground">
                          POST /api/connect/v1/&lt;connection&gt;/{path}
                        </code>
                      ))}
                      <span className="block text-muted-foreground">{r.auth}</span>
                    </span>
                  ))
                : none}
            </Row>
            <Row label="Category">{t.categoryLabel}</Row>
            {t.vendor ? <Row label="Vendor">{t.vendor}</Row> : null}
            {t.documentationUrl ? (
              <Row label="API reference">
                <a href={t.documentationUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                  {t.documentationUrl}
                </a>
              </Row>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Definition</summary>
        <p className="mt-2">
          <code className="font-mono text-xs">{t.key}</code> v{t.version}, {t.driver} driver. It never changes anything in the system.{" "}
          <Link href={`/integrations/types/new?from=${t.origin}:${encodeURIComponent(t.key)}`} className="text-primary hover:underline">
            Use as a starting point
          </Link>
        </p>
      </details>
    </div>
  );
}
