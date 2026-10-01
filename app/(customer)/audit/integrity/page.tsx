import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { verifyAuditChain } from "@/lib/audit/integrity";
import { listControlFrameworks } from "@/modules/certification-compliance/service";
import { Badge, Card, CardBody, CardHeader, KpiCard } from "@/modules/ui";

// FOUNDATION-P0-29 — Audit Integrity: proves the audit trail has not been
// altered (append-only, hash-chained per tenant, migration 0104) and shows
// the financial and privacy control frameworks it evidences. Verification
// runs on every visit and is itself audited.

export const metadata = { title: "Audit Integrity" };
export const dynamic = "force-dynamic";

const FINANCIAL = new Set(["sox_itgc", "soc1", "pci_dss", "glba", "dora", "rbi_itgrc", "sebi_cscrf", "cert_in"]);
const PRIVACY = new Set(["gdpr", "dpdp"]);

export default async function AuditIntegrityPage() {
  let ctx;
  try {
    ctx = await requirePermission("audit.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/");
    throw err;
  }
  const [report, frameworks] = await Promise.all([verifyAuditChain(ctx.tenantId!, ctx.userId), listControlFrameworks()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Audit Integrity</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every audit entry is append-only and linked to the one before it by a SHA-256 hash. Changing, deleting or reordering any entry breaks the chain, and this check finds where.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={report.intact ? "ShieldCheck" : "ShieldAlert"} label="Chain status" value={report.intact ? "Intact" : "Broken"} tone={report.intact ? "success" : "danger"} emphasis />
        <KpiCard icon="FileText" label="Entries verified" value={report.checked.toLocaleString()} tone="primary" />
        <KpiCard icon="Clock" label="Verified at" value={new Date(report.verifiedAt).toLocaleTimeString("en-GB")} tone="neutral" />
      </div>

      {!report.intact ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The chain breaks at entry #{report.brokenAtSeq}: {report.reason}. Treat this as a security incident: preserve the database and contact WonderID support.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="How the trail is protected" />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              <li>No role, including WonderID&apos;s own service, can update an audit entry; the database refuses it.</li>
              <li>Entries are removed only by the retention purge: oldest first, never the last 365 days, never under a legal hold, each purge leaving a checkpoint the chain resumes from.</li>
              <li>Entries {report.firstSeq ?? "—"} to {report.lastSeq ?? "—"} are present; every verification is itself recorded in this trail.</li>
              <li>Platform-administration actions are kept in a separate, equally append-only log.</li>
            </ul>
            {report.purges.length ? (
              <div className="mt-3 text-xs text-muted-foreground">
                Retention purges:{" "}
                {report.purges.map((p) => `${p.purgedCount} entries up to #${p.upToSeq} (before ${p.purgedBefore.slice(0, 10)})`).join("; ")}
              </div>
            ) : null}
            <p className="mt-3 text-sm">
              <Link href="/audit" className="text-primary hover:underline">
                Open the audit trail
              </Link>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Frameworks this evidence supports" description="Map controls to policies and attach evidence for your auditors. Mapping is evidence, not certification." />
          <CardBody className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Financial and sector</p>
              <div className="flex flex-wrap gap-1.5">
                {frameworks.filter((f) => FINANCIAL.has(f.id)).map((f) => (
                  <Badge key={f.id} tone="accent">
                    {f.displayName}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Privacy</p>
              <div className="flex flex-wrap gap-1.5">
                {frameworks.filter((f) => PRIVACY.has(f.id)).map((f) => (
                  <Badge key={f.id} tone="info">
                    {f.displayName}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Security and AI</p>
              <div className="flex flex-wrap gap-1.5">
                {frameworks.filter((f) => !FINANCIAL.has(f.id) && !PRIVACY.has(f.id)).map((f) => (
                  <Badge key={f.id}>{f.displayName}</Badge>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
