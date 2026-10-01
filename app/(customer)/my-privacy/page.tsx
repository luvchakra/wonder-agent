import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { Badge, Card, CardBody, CardHeader, EmptyState, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { getPrivacyContacts, listConsentPurposes, listMyConsents, listMyRequests } from "@/modules/privacy/service";
import { REGIME_LABEL, REGIME_REQUEST_TYPES, REQUEST_TYPE_LABEL } from "@/modules/privacy/rules";
import { createMyRequestAction, setMyConsentAction, withdrawMyRequestAction } from "@/app/actions/privacy";
import { PrivacyForm } from "../settings/privacy/PrivacyForm";

// COMPLIANCE-P0-12 — every member's own privacy page: who to contact, a
// download of their data, their consents (withdrawn as easily as given),
// and their rights requests with the date the organization must answer by.
// Needs only an active membership: data rights belong to everyone.

export const metadata = { title: "My privacy" };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function MyPrivacyPage() {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) redirect("/sign-in");
  const [contacts, purposes, consents, requests] = await Promise.all([
    getPrivacyContacts(ctx.tenantId),
    listConsentPurposes(ctx.tenantId, true),
    listMyConsents(ctx.tenantId, ctx.userId),
    listMyRequests(ctx.tenantId, ctx.userId),
  ]);
  const granted = new Set(consents.filter((c) => c.status === "granted").map((c) => c.purposeId));
  const allTypes = [...new Set(contacts.regimes.flatMap((r) => REGIME_REQUEST_TYPES[r]))];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">My privacy</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">See and control the personal data this organization holds about you in WonderID, under {contacts.regimes.map((r) => REGIME_LABEL[r]).join(", ")}.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your data" description="A machine-readable copy of what this organization holds about you here" />
          <CardBody className="space-y-2">
            <a href="/api/v1/privacy/me/export" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Download my data (JSON)
            </a>
            <p className="text-xs text-muted-foreground">Includes your account, roles, groups, identity record, application accounts, consents, requests, notifications and your recent activity.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Who to contact" />
          <CardBody className="space-y-1 text-sm">
            {contacts.dpoEmail || contacts.grievanceOfficerEmail ? (
              <>
                {contacts.dpoEmail ? (
                  <p>
                    Data Protection Officer: {contacts.dpoName ? `${contacts.dpoName}, ` : ""}
                    <a className="text-primary hover:underline" href={`mailto:${contacts.dpoEmail}`}>
                      {contacts.dpoEmail}
                    </a>
                  </p>
                ) : null}
                {contacts.grievanceOfficerEmail ? (
                  <p>
                    Grievance officer: {contacts.grievanceOfficerName ? `${contacts.grievanceOfficerName}, ` : ""}
                    <a className="text-primary hover:underline" href={`mailto:${contacts.grievanceOfficerEmail}`}>
                      {contacts.grievanceOfficerEmail}
                    </a>
                    {contacts.grievanceOfficerPhone ? ` · ${contacts.grievanceOfficerPhone}` : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">Your organization has not published its privacy contacts yet. You can still raise a request below.</p>
            )}
            {contacts.privacyNoticeUrl ? (
              <p>
                <a className="text-primary hover:underline" href={contacts.privacyNoticeUrl} target="_blank" rel="noopener noreferrer">
                  Read the privacy notice
                </a>
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">If you are not satisfied with a response, you can complain to your data protection authority (in India, the Data Protection Board after using the grievance route).</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Consents" description="Optional uses of your data. Withdrawing is as easy as giving consent and takes effect immediately." />
        <CardBody>
          {purposes.length === 0 ? (
            <EmptyState title="Nothing here needs your consent" description="Your organization processes your identity data for access governance on another lawful basis, described in its privacy notice." />
          ) : (
            <ul className="divide-y divide-border">
              {purposes.map((p) => {
                const on = granted.has(p.id);
                return (
                  <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="max-w-2xl">
                      <p className="text-sm font-medium text-foreground">
                        {p.title} <Badge>{p.noticeVersion}</Badge>
                      </p>
                      <p className="text-sm text-muted-foreground">{p.description}</p>
                    </div>
                    <form action={setMyConsentAction.bind(null, p.id, !on)}>
                      <button type="submit" className={on ? "rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-accent" : "rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90"}>
                        {on ? "Withdraw consent" : "Give consent"}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader title="My requests" />
          <CardBody>
            {requests.length === 0 ? (
              <EmptyState title="No requests yet" />
            ) : (
              <ul className="divide-y divide-border">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <span className="font-mono text-xs">{r.reference}</span> · {REQUEST_TYPE_LABEL[r.requestType]}
                      <p className="text-xs text-muted-foreground">
                        Received {fmt(r.receivedAt)} · answer due by {fmt(r.extendedDueAt ?? r.dueAt)}
                        {r.extendedDueAt ? ` (extended: ${r.extensionReason})` : ""}
                      </p>
                      {r.outcomeReason ? <p className="text-xs text-foreground">{r.outcomeReason}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={r.status === "completed" ? "success" : r.status === "rejected" ? "danger" : "info"}>{r.status.replace("_", " ")}</Badge>
                      {["received", "identity_verification", "in_progress"].includes(r.status) ? (
                        <form action={withdrawMyRequestAction.bind(null, r.id)}>
                          <button type="submit" className="text-xs text-primary hover:underline">
                            Withdraw
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Make a request" description="Correction, erasure, objection, grievance and more" />
          <CardBody>
            <PrivacyForm action={createMyRequestAction} submitLabel="Send request" pendingLabel="Sending…">
              <div>
                <label htmlFor="mr-regime" className={fieldLabelClass}>
                  Under
                </label>
                <select id="mr-regime" name="regime" className={fieldInputClass}>
                  {contacts.regimes.map((r) => (
                    <option key={r} value={r}>
                      {REGIME_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mr-type" className={fieldLabelClass}>
                  I want to
                </label>
                <select id="mr-type" name="requestType" className={fieldInputClass}>
                  {allTypes.map((t) => (
                    <option key={t} value={t}>
                      {REQUEST_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mr-desc" className={fieldLabelClass}>
                  Details
                </label>
                <textarea id="mr-desc" name="description" rows={3} maxLength={4000} className={fieldInputClass} placeholder="For a correction, say what is wrong and what it should be." />
              </div>
            </PrivacyForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
