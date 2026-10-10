import Link from "next/link";
import { getRecordProvenance } from "@/lib/provenance/recordProvenance";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { RecordProvenance, Badge, Card, CardBody, CardHeader, fieldInputClass, fieldLabelClass, type BadgeTone } from "@/modules/ui";
import { breachFacts, getBreach } from "@/modules/privacy/service";
import { REGIME_LABEL, breachObligations, type BreachObligation } from "@/modules/privacy/rules";
import { updateBreachAction } from "@/app/actions/privacy";
import { PrivacyForm } from "../../PrivacyForm";

// COMPLIANCE-P0-12 — one personal-data breach and its statutory clocks.
// A notification time, once recorded, is evidence and cannot be rewritten.

export const metadata = { title: "Breach" };

const TONE: Record<BreachObligation["state"], BadgeTone> = { done: "success", pending: "warning", overdue: "danger", not_required: "neutral" };
const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "—");

export default async function BreachPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("privacy.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [breach, provenance] = await Promise.all([getBreach(ctx.tenantId!, id), getRecordProvenance(ctx.tenantId!, "privacy_breach_incidents", id)]);
  if (!breach) notFound();
  const obligations = breachObligations(breachFacts(breach), new Date());
  const canManage = ctx.permissions.includes("privacy.incidents.manage") && breach.status !== "closed";
  const hidden = <input type="hidden" name="breachId" value={breach.id} />;

  const timeField = (name: string, label: string, value: string | null) => (
    <div>
      <label htmlFor={`b-${name}`} className={fieldLabelClass}>
        {label}
      </label>
      {value ? <p className="text-sm text-foreground">{fmt(value)}</p> : <input id={`b-${name}`} name={name} type="datetime-local" className={fieldInputClass} />}
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link href="/settings/privacy?tab=breaches" className="text-primary hover:underline">
          ← Breach register
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground">{breach.title}</h1>
        <span className="font-mono text-sm text-muted-foreground">{breach.reference}</span>
        <Badge tone={breach.severity === "critical" || breach.severity === "high" ? "danger" : "warning"}>{breach.severity}</Badge>
        <Badge tone={breach.status === "closed" ? "neutral" : "warning"}>{breach.status}</Badge>
      </div>
      <RecordProvenance record={provenance} className="-mt-3" />

      <Card>
        <CardHeader title="Statutory notifications" description={`Clocks run from detection: ${fmt(breach.detectedAt)}. Laws: ${breach.regimes.map((r) => REGIME_LABEL[r]).join(", ")}.`} />
        <CardBody>
          <ul className="divide-y divide-border">
            {obligations.map((o) => (
              <li key={o.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{o.label}</p>
                  <p className="text-xs text-muted-foreground">{o.basis}</p>
                </div>
                <div className="text-right text-sm">
                  <Badge tone={TONE[o.state]}>{o.state.replace("_", " ")}</Badge>
                  <p className="text-xs text-muted-foreground">{o.doneAt ? `Done ${fmt(o.doneAt)}` : o.dueAt ? `Due ${fmt(o.dueAt)}` : ""}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="What happened" />
          <CardBody className="space-y-2 text-sm">
            <p className="whitespace-pre-wrap text-foreground">{breach.description}</p>
            <p className="text-muted-foreground">
              Risk to people: {breach.riskToIndividuals.replace("_", " ")} · Affected: {breach.subjectsAffected ?? "unknown"} · Data: {breach.dataCategories.join(", ") || "—"}
            </p>
            {breach.rootCause ? <p className="text-foreground">Root cause: {breach.rootCause}</p> : null}
            {breach.remediation ? <p className="text-foreground">Remediation: {breach.remediation}</p> : null}
          </CardBody>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader title="Record progress" description="Times are kept as evidence: set once, never rewritten." />
            <CardBody className="space-y-4">
              <PrivacyForm action={updateBreachAction} submitLabel="Save" pendingLabel="Saving…">
                {hidden}
                <div className="grid gap-3 sm:grid-cols-2">
                  {timeField("containedAt", "Contained at", breach.containedAt)}
                  {breach.regimes.some((r) => r === "gdpr" || r === "uk_gdpr") ? timeField("authorityNotifiedAt", "Authority notified at", breach.authorityNotifiedAt) : null}
                  {breach.regimes.includes("dpdp") ? timeField("dpbNotifiedAt", "Data Protection Board intimated at", breach.dpbNotifiedAt) : null}
                  {breach.regimes.includes("dpdp") ? timeField("dpbReportAt", "Board report submitted at", breach.dpbReportAt) : null}
                  {timeField("subjectsNotifiedAt", "Individuals notified at", breach.subjectsNotifiedAt)}
                </div>
                <div>
                  <label htmlFor="b-ref" className={fieldLabelClass}>
                    Authority reference
                  </label>
                  <input id="b-ref" name="authorityReference" defaultValue={breach.authorityReference ?? ""} className={fieldInputClass} />
                </div>
                <div>
                  <label htmlFor="b-root" className={fieldLabelClass}>
                    Root cause
                  </label>
                  <textarea id="b-root" name="rootCause" rows={2} defaultValue={breach.rootCause ?? ""} className={fieldInputClass} />
                </div>
                <div>
                  <label htmlFor="b-rem" className={fieldLabelClass}>
                    Remediation
                  </label>
                  <textarea id="b-rem" name="remediation" rows={2} defaultValue={breach.remediation ?? ""} className={fieldInputClass} />
                </div>
                <div>
                  <label htmlFor="b-delay" className={fieldLabelClass}>
                    Reason for any late notification (GDPR Art. 33(1))
                  </label>
                  <textarea id="b-delay" name="delayReason" rows={2} defaultValue={breach.delayReason ?? ""} className={fieldInputClass} />
                </div>
              </PrivacyForm>
              <PrivacyForm action={updateBreachAction} submitLabel="Close breach" pendingLabel="Closing…" variant="outline">
                {hidden}
                <input type="hidden" name="intent" value="close" />
                <p className="text-xs text-muted-foreground">Closing needs every required notification recorded (or a reason for delay), the root cause and the remediation.</p>
              </PrivacyForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
