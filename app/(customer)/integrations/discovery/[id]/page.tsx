import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { allowedDecisions, getDiscovery, getIntegration } from "@/modules/integrations/service";
import { getApplicationDetail, listApplicationsForMatching } from "@/modules/access-governance/service";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { APPLICATION_TYPES, CATALOG_LEVELS, DATA_CLASSIFICATION_LEVELS } from "@/lib/shared/types/access-governance";
import { Badge, Card, CardBody, CardHeader } from "@/modules/ui";
import { APP_TYPE_LABEL } from "../../../access/applications/labels";
import { DecisionForms } from "../DiscoveryForms";
import { DISCOVERY_SOURCE_LABEL, DISCOVERY_STATUS_LABEL, when } from "../labels";

// INTEGRATION-P0-10 — one discovered application: what found it and the
// evidence, the catalog match or suggestion, and the decision.

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

const evidenceValue = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? Object.values(x).filter(Boolean).join(" · ") : String(x))).join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};
const EVIDENCE_LABEL: Record<string, string> = {
  specVersion: "Specification",
  apiVersion: "API version",
  paths: "Paths",
  securitySchemes: "Security schemes",
  patch: "Supports PATCH",
  bulk: "Supports bulk",
  filter: "Supports filter",
  changePassword: "Supports password change",
  authenticationSchemes: "Authentication",
  documentationUri: "Documentation",
  externalId: "Identifier in the connector",
  type: "Type in the connector",
};

export default async function DiscoveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { id } = await params;
  const tenantId = ctx.tenantId!;
  const d = await getDiscovery(tenantId, id);
  if (!d) notFound();
  const canUpdate = ctx.permissions.includes("integration.update");
  const canManageCatalog = canUpdate && ctx.permissions.includes("access.manage");
  const allowed = canUpdate ? allowedDecisions(d.status) : [];
  const needsLists = canManageCatalog && (allowed.includes("register") || allowed.includes("link"));
  const [app, suggested, integration, people, catalog] = await Promise.all([
    d.applicationId && ctx.permissions.includes("access.read") ? getApplicationDetail(tenantId, d.applicationId) : Promise.resolve(null),
    d.suggestedApplicationId && ctx.permissions.includes("access.read") ? getApplicationDetail(tenantId, d.suggestedApplicationId) : Promise.resolve(null),
    d.sourceIntegrationId ? getIntegration(tenantId, d.sourceIntegrationId) : Promise.resolve(null),
    needsLists ? listAccountableHumans(tenantId) : Promise.resolve([]),
    needsLists ? listApplicationsForMatching(tenantId) : Promise.resolve([]),
  ]);
  const status = DISCOVERY_STATUS_LABEL[d.status];
  const evidence = Object.entries(d.evidence).filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/integrations/discovery" className="hover:text-foreground hover:underline">
          Application discovery
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{d.name}</span>
      </nav>
      <div>
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">{d.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone="neutral">{DISCOVERY_SOURCE_LABEL[d.source]}</Badge>
          {d.sightings > 1 ? <Badge tone="neutral">Seen {d.sightings} times</Badge> : null}
        </div>
        {d.description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{d.description}</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="What was found" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Vendor">{d.vendor}</Detail>
              <Detail label="Address">{d.url ? <span className="font-mono text-xs">{d.url}</span> : null}</Detail>
              <Detail label="Found by">
                {integration ? (
                  <Link href={`/integrations/${integration.id}`} className="text-primary hover:underline">
                    {integration.name}
                  </Link>
                ) : (
                  DISCOVERY_SOURCE_LABEL[d.source]
                )}
              </Detail>
              <Detail label="First seen">{when(d.firstSeenAt)}</Detail>
              <Detail label="Last seen">{when(d.lastSeenAt)}</Detail>
              {evidence.map(([k, v]) => (
                <Detail key={k} label={EVIDENCE_LABEL[k] ?? k}>
                  {evidenceValue(v)}
                </Detail>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="In the catalog" />
          <CardBody className="space-y-3 text-sm">
            {app ? (
              <p>
                {d.status === "REGISTERED" ? "Registered as " : "Matched to "}
                <Link href={`/access/applications/${app.id}`} className="font-medium text-primary hover:underline">
                  {app.displayName ?? app.name}
                </Link>
                .
              </p>
            ) : d.applicationId ? (
              <p className="text-muted-foreground">Matched to an application.</p>
            ) : (
              <p className="text-muted-foreground">Not in the catalog.</p>
            )}
            {suggested && d.status === "UNRECOGNIZED" ? (
              <p>
                Possibly{" "}
                <Link href={`/access/applications/${suggested.id}`} className="font-medium text-primary hover:underline">
                  {suggested.displayName ?? suggested.name}
                </Link>
                : similar name. Link it if it is the same application.
              </p>
            ) : null}
            {d.decidedAt ? (
              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">Decided {when(d.decidedAt)}</p>
                {d.decisionNote ? <p className="mt-1">“{d.decisionNote}”</p> : null}
                {d.exceptionUntil ? <p className="mt-1 text-xs text-muted-foreground">Exception until {when(d.exceptionUntil)}</p> : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {allowed.length ? (
        <Card>
          <CardHeader title="Decide" description={d.status === "UNRECOGNIZED" ? "Every decision is recorded with who made it and why." : undefined} />
          <CardBody>
            <DecisionForms
              discoveryId={d.id}
              name={d.name}
              allowed={allowed}
              canManageCatalog={canManageCatalog}
              canConnect={Boolean(d.sourceIntegrationId)}
              people={people.map((p) => ({ id: p.id, label: `${p.displayName}${p.email && p.email !== p.displayName ? ` (${p.email})` : ""}` }))}
              applications={catalog.map((a) => ({ id: a.id, label: a.displayName ?? a.name })).sort((a, b) => a.label.localeCompare(b.label))}
              suggestedApplicationId={d.suggestedApplicationId}
              appTypes={APPLICATION_TYPES.map((t) => ({ id: t, label: APP_TYPE_LABEL[t] }))}
              levels={[...CATALOG_LEVELS]}
              classifications={[...DATA_CLASSIFICATION_LEVELS]}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
