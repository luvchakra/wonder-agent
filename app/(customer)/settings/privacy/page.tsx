import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass, type BadgeTone } from "@/modules/ui";
import {
  breachFacts,
  getPrivacySettings,
  listBreaches,
  listConsentPurposes,
  listConsentRecords,
  listLegalHolds,
  listProcessingActivities,
  listRequests,
  listRetentionPolicies,
} from "@/modules/privacy/service";
import { REGIMES, REGIME_LABEL, REQUEST_TYPE_LABEL, RETENTION_CATEGORIES, breachObligations, deadlineState, type DeadlineState } from "@/modules/privacy/rules";
import {
  createBreachAction,
  createRequestAction,
  placeLegalHoldAction,
  releaseLegalHoldAction,
  saveConsentPurposeAction,
  savePrivacySettingsAction,
  saveProcessingActivityAction,
  saveRetentionPolicyAction,
  setProcessingActivityStatusAction,
} from "@/app/actions/privacy";
import { PrivacyForm } from "./PrivacyForm";

// COMPLIANCE-P0-12 — the privacy programme (GDPR / UK GDPR / DPDP / CCPA):
// contacts, rights requests with statutory deadlines, records of
// processing, consent, retention and legal holds, and the breach register.
// Viewing needs privacy.view; each change is checked again by its action.

export const metadata = { title: "Privacy & Data Protection" };

const SECTIONS = [
  { key: "requests", label: "Rights requests" },
  { key: "breaches", label: "Breach register" },
  { key: "ropa", label: "Records of processing" },
  { key: "consent", label: "Consent" },
  { key: "retention", label: "Retention & holds" },
  { key: "contacts", label: "Contacts & laws" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const DEADLINE_TONE: Record<DeadlineState, BadgeTone> = { on_track: "success", due_soon: "warning", overdue: "danger", closed: "neutral" };
const DEADLINE_LABEL: Record<DeadlineState, string> = { on_track: "On track", due_soon: "Due within 7 days", overdue: "Overdue", closed: "Closed" };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

function Text({ name, label, defaultValue, type = "text", required, placeholder }: { name: string; label: string; defaultValue?: string | null; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={`pf-${name}`} className={fieldLabelClass}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      <input id={`pf-${name}`} name={name} type={type} required={required} defaultValue={defaultValue ?? ""} placeholder={placeholder} className={fieldInputClass} />
    </div>
  );
}

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("privacy.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const sp = await searchParams;
  const tab: SectionKey = (SECTIONS.find((s) => s.key === sp.tab)?.key ?? "requests") as SectionKey;
  const can = (p: string) => ctx.permissions.includes(p);
  const [settings, requests, breaches, activities, purposes, consents, policies, holds] = await Promise.all([
    getPrivacySettings(tenantId),
    listRequests(tenantId, { limit: 100 }),
    listBreaches(tenantId),
    listProcessingActivities(tenantId),
    listConsentPurposes(tenantId),
    listConsentRecords(tenantId, { limit: 50 }),
    listRetentionPolicies(tenantId),
    listLegalHolds(tenantId),
  ]);
  const now = new Date();
  const openRequests = requests.requests.filter((r) => !["completed", "rejected", "withdrawn"].includes(r.status));
  const overdue = openRequests.filter((r) => deadlineState(r.status, new Date(r.extendedDueAt ?? r.dueAt), now) === "overdue").length;
  const openBreaches = breaches.filter((b) => b.status !== "closed");
  const breachOverdue = openBreaches.filter((b) => breachObligations(breachFacts(b), now).some((o) => o.state === "overdue")).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Privacy &amp; Data Protection</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Run your GDPR and DPDP obligations for the people whose identity data WonderID governs: rights requests on statutory clocks, records of processing, consent, retention and breach notification.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="FileText" label="Open requests" value={openRequests.length} tone={openRequests.length ? "primary" : "neutral"} />
        <KpiCard icon="Clock" label="Overdue requests" value={overdue} tone={overdue ? "danger" : "success"} />
        <KpiCard icon="ShieldAlert" label="Open breaches" value={openBreaches.length} tone={openBreaches.length ? "warning" : "success"} />
        <KpiCard icon="TriangleAlert" label="Breaches with overdue notices" value={breachOverdue} tone={breachOverdue ? "danger" : "success"} />
      </div>

      <nav aria-label="Privacy sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={`/settings/privacy?tab=${s.key}`}
            aria-current={tab === s.key ? "page" : undefined}
            className={
              tab === s.key
                ? "shrink-0 border-b-2 border-primary px-3 py-2.5 text-sm font-medium text-primary"
                : "shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            }
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {tab === "requests" ? (
        <div className={can("privacy.requests.process") ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}>
          <Card>
            <CardHeader title={`${requests.total} request${requests.total === 1 ? "" : "s"}`} description="Soonest deadline first. The clock runs from receipt; GDPR one month, DPDP 90 days, CCPA 45 days." />
            <CardBody>
              {requests.requests.length === 0 ? (
                <EmptyState title="No privacy requests yet" description="Members can raise requests from My privacy; log ones received by email or post here." />
              ) : (
                <TableContainer>
                  <Thead>
                    <tr>
                      <Th>Reference</Th>
                      <Th>Right</Th>
                      <Th hideBelow="lg">Law</Th>
                      <Th>Status</Th>
                      <Th>Due</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {requests.requests.map((r) => {
                      const due = r.extendedDueAt ?? r.dueAt;
                      const state = deadlineState(r.status, new Date(due), now);
                      return (
                        <Tr key={r.id}>
                          <Td>
                            <Link href={`/settings/privacy/requests/${r.id}`} className="font-mono text-xs font-medium text-foreground hover:text-primary">
                              {r.reference}
                            </Link>
                          </Td>
                          <Td>{REQUEST_TYPE_LABEL[r.requestType]}</Td>
                          <Td hideBelow="lg">{REGIME_LABEL[r.regime]}</Td>
                          <Td>
                            <Badge tone={r.status === "completed" ? "success" : r.status === "rejected" ? "danger" : "info"}>{r.status.replace("_", " ")}</Badge>
                          </Td>
                          <Td>
                            <span className="tabular-nums">{fmt(due)}</span> <Badge tone={DEADLINE_TONE[state]}>{DEADLINE_LABEL[state]}</Badge>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </TableContainer>
              )}
            </CardBody>
          </Card>
          {can("privacy.requests.process") ? (
            <Card>
              <CardHeader title="Log a request" description="One received outside WonderID" />
              <CardBody>
                <PrivacyForm action={createRequestAction} submitLabel="Log request" pendingLabel="Logging…">
                  <div>
                    <label htmlFor="pr-regime" className={fieldLabelClass}>
                      Law
                    </label>
                    <select id="pr-regime" name="regime" className={fieldInputClass} defaultValue={settings.regimes[0] ?? "gdpr"}>
                      {REGIMES.map((r) => (
                        <option key={r} value={r}>
                          {REGIME_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pr-type" className={fieldLabelClass}>
                      Right exercised
                    </label>
                    <select id="pr-type" name="requestType" className={fieldInputClass}>
                      {Object.entries(REQUEST_TYPE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Text name="subjectEmail" label="Requester's email" type="email" required />
                  <Text name="subjectName" label="Requester's name" />
                  <div>
                    <label htmlFor="pr-channel" className={fieldLabelClass}>
                      Received by
                    </label>
                    <select id="pr-channel" name="channel" className={fieldInputClass}>
                      <option value="email">Email</option>
                      <option value="web_form">Web form</option>
                      <option value="phone">Phone</option>
                      <option value="post">Post</option>
                      <option value="api">API</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <Text name="receivedAt" label="Received on" type="date" />
                  <div>
                    <label htmlFor="pr-desc" className={fieldLabelClass}>
                      What they asked for
                    </label>
                    <textarea id="pr-desc" name="description" rows={3} maxLength={4000} className={fieldInputClass} />
                  </div>
                </PrivacyForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "breaches" ? (
        <div className={can("privacy.incidents.manage") ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}>
          <Card>
            <CardHeader title="Personal-data breaches" description="Each with its statutory notices: GDPR authority within 72h; DPDP Board without delay plus a report within 72h, and every affected person." />
            <CardBody>
              {breaches.length === 0 ? (
                <EmptyState title="No breaches recorded" />
              ) : (
                <TableContainer>
                  <Thead>
                    <tr>
                      <Th>Reference</Th>
                      <Th>Incident</Th>
                      <Th hideBelow="lg">Detected</Th>
                      <Th>Notices</Th>
                      <Th>Status</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {breaches.map((b) => {
                      const ob = breachObligations(breachFacts(b), now);
                      const overdueN = ob.filter((o) => o.state === "overdue").length;
                      const pendingN = ob.filter((o) => o.state === "pending").length;
                      return (
                        <Tr key={b.id}>
                          <Td>
                            <Link href={`/settings/privacy/breaches/${b.id}`} className="font-mono text-xs font-medium text-foreground hover:text-primary">
                              {b.reference}
                            </Link>
                          </Td>
                          <Td>{b.title}</Td>
                          <Td hideBelow="lg">{fmt(b.detectedAt)}</Td>
                          <Td>{overdueN ? <Badge tone="danger">{overdueN} overdue</Badge> : pendingN ? <Badge tone="warning">{pendingN} pending</Badge> : <Badge tone="success">Done</Badge>}</Td>
                          <Td>
                            <Badge tone={b.status === "closed" ? "neutral" : "warning"}>{b.status}</Badge>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </TableContainer>
              )}
            </CardBody>
          </Card>
          {can("privacy.incidents.manage") ? (
            <Card>
              <CardHeader title="Record a breach" description="Starts the notification clocks from the detection time" />
              <CardBody>
                <PrivacyForm action={createBreachAction} submitLabel="Record breach" pendingLabel="Recording…" variant="destructive">
                  <Text name="title" label="Title" required />
                  <div>
                    <label htmlFor="br-desc" className={fieldLabelClass}>
                      What happened <span className="text-destructive">*</span>
                    </label>
                    <textarea id="br-desc" name="description" required minLength={10} rows={3} className={fieldInputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="br-sev" className={fieldLabelClass}>
                        Severity
                      </label>
                      <select id="br-sev" name="severity" className={fieldInputClass} defaultValue="high">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="br-risk" className={fieldLabelClass}>
                        Risk to people
                      </label>
                      <select id="br-risk" name="riskToIndividuals" className={fieldInputClass} defaultValue="risk">
                        <option value="unlikely">Unlikely</option>
                        <option value="risk">A risk</option>
                        <option value="high_risk">High risk</option>
                      </select>
                    </div>
                  </div>
                  <fieldset>
                    <legend className={fieldLabelClass}>Laws covering the affected people</legend>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {REGIMES.map((r) => (
                        <label key={r} className="flex items-center gap-1.5">
                          <input type="checkbox" name="regimes" value={r} defaultChecked={settings.regimes.includes(r)} /> {REGIME_LABEL[r]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Text name="detectedAt" label="Detected at (blank = now)" type="datetime-local" />
                  <Text name="occurredAt" label="Occurred at (if known)" type="datetime-local" />
                  <Text name="subjectsAffected" label="People affected (estimate)" type="number" />
                  <Text name="dataCategories" label="Data affected (comma separated)" placeholder="email, name, access entitlements" />
                </PrivacyForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "ropa" ? (
        <div className={can("privacy.manage") ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]" : ""}>
          <Card>
            <CardHeader title="Records of processing activities" description="GDPR Art. 30: what you process, why, on what lawful basis, who receives it, transfers and retention." />
            <CardBody>
              {activities.length === 0 ? (
                <EmptyState title="No records yet" description="Start with identity governance itself: people's identity, access and activity data for access governance and audit." />
              ) : (
                <ul className="divide-y divide-border">
                  {activities.map((a) => (
                    <li key={a.id} className="space-y-1 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{a.name}</span>
                        <Badge tone="accent">{a.lawfulBasis.replace(/_/g, " ")}</Badge>
                        {a.specialCategories ? <Badge tone="warning">Special categories</Badge> : null}
                        {a.dpiaRequired ? <Badge tone={a.dpiaCompletedAt ? "success" : "danger"}>{a.dpiaCompletedAt ? "DPIA done" : "DPIA required"}</Badge> : null}
                        {a.status === "retired" ? <Badge>Retired</Badge> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">{a.purpose}</p>
                      <p className="text-xs text-muted-foreground">
                        Data: {a.dataCategories.join(", ") || "—"} · Recipients: {a.recipients.join(", ") || "—"} · Transfers: {a.transferCountries.length ? `${a.transferCountries.join(", ")} (${a.transferMechanism})` : "none"} · Retention: {a.retentionDays ? `${a.retentionDays} days` : "—"}
                      </p>
                      {can("privacy.manage") ? (
                        <form action={setProcessingActivityStatusAction.bind(null, a.id, a.status === "active" ? "retired" : "active")}>
                          <button type="submit" className="text-xs text-primary hover:underline">
                            {a.status === "active" ? "Retire" : "Reactivate"}
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {can("privacy.manage") ? (
            <Card>
              <CardHeader title="Add a record" />
              <CardBody>
                <PrivacyForm action={saveProcessingActivityAction} submitLabel="Save record" pendingLabel="Saving…">
                  <Text name="name" label="Processing activity" required />
                  <div>
                    <label htmlFor="ro-purpose" className={fieldLabelClass}>
                      Purpose <span className="text-destructive">*</span>
                    </label>
                    <textarea id="ro-purpose" name="purpose" required rows={2} className={fieldInputClass} />
                  </div>
                  <div>
                    <label htmlFor="ro-basis" className={fieldLabelClass}>
                      Lawful basis
                    </label>
                    <select id="ro-basis" name="lawfulBasis" className={fieldInputClass} defaultValue="legitimate_interests">
                      <option value="legitimate_interests">GDPR: legitimate interests</option>
                      <option value="contract">GDPR: contract</option>
                      <option value="legal_obligation">GDPR: legal obligation</option>
                      <option value="consent">GDPR: consent</option>
                      <option value="vital_interests">GDPR: vital interests</option>
                      <option value="public_task">GDPR: public task</option>
                      <option value="dpdp_consent">DPDP: consent (s.6)</option>
                      <option value="dpdp_legitimate_use">DPDP: legitimate use (s.7, e.g. employment)</option>
                    </select>
                  </div>
                  <Text name="dataCategories" label="Personal data (comma separated)" placeholder="name, work email, entitlements" />
                  <Text name="subjectCategories" label="Whose data" placeholder="employees, contractors" />
                  <Text name="recipients" label="Recipients / processors" placeholder="IdP, HR system" />
                  <Text name="transferCountries" label="Transfer countries (ISO codes)" placeholder="US, SG" />
                  <div>
                    <label htmlFor="ro-mech" className={fieldLabelClass}>
                      Transfer safeguard
                    </label>
                    <select id="ro-mech" name="transferMechanism" className={fieldInputClass}>
                      <option value="none">None (no transfer)</option>
                      <option value="adequacy">Adequacy decision</option>
                      <option value="sccs">Standard contractual clauses</option>
                      <option value="bcrs">Binding corporate rules</option>
                      <option value="derogation">Art. 49 derogation</option>
                      <option value="dpdp_permitted">DPDP: not a restricted country (s.16)</option>
                    </select>
                  </div>
                  <Text name="retentionDays" label="Retention (days)" type="number" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="specialCategories" /> Special-category / sensitive data
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="dpiaRequired" /> A DPIA is required
                  </label>
                </PrivacyForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "consent" ? (
        <div className="space-y-5">
          <div className={can("privacy.manage") ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}>
            <Card>
              <CardHeader title="Consent purposes" description="Each purpose is shown to members on My privacy with its notice version. Changing its wording needs a new version." />
              <CardBody>
                {purposes.length === 0 ? (
                  <EmptyState title="No consent purposes" description="Most identity governance relies on legitimate interests or legitimate use; add purposes only for optional processing." />
                ) : (
                  <ul className="divide-y divide-border">
                    {purposes.map((p) => (
                      <li key={p.id} className="py-2">
                        <span className="font-medium text-foreground">{p.title}</span> <Badge>{p.noticeVersion}</Badge> {p.active ? null : <Badge tone="neutral">Inactive</Badge>}
                        <p className="text-sm text-muted-foreground">{p.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            {can("privacy.manage") ? (
              <Card>
                <CardHeader title="Add a purpose" />
                <CardBody>
                  <PrivacyForm action={saveConsentPurposeAction} submitLabel="Save purpose" pendingLabel="Saving…">
                    <Text name="key" label="Key" placeholder="product_updates" required />
                    <Text name="title" label="Title" required />
                    <div>
                      <label htmlFor="cp-desc" className={fieldLabelClass}>
                        Plain-language notice <span className="text-destructive">*</span>
                      </label>
                      <textarea id="cp-desc" name="description" required minLength={10} rows={3} className={fieldInputClass} />
                    </div>
                    <Text name="noticeVersion" label="Notice version" defaultValue="v1" required />
                  </PrivacyForm>
                </CardBody>
              </Card>
            ) : null}
          </div>
          <Card>
            <CardHeader title="Consent ledger" description={`Latest ${consents.records.length} of ${consents.total}. Each grant is kept with its notice version and language; withdrawal closes it.`} />
            <CardBody>
              {consents.records.length === 0 ? (
                <EmptyState title="No consents recorded" />
              ) : (
                <TableContainer>
                  <Thead>
                    <tr>
                      <Th>Person</Th>
                      <Th>Purpose</Th>
                      <Th hideBelow="lg">Notice</Th>
                      <Th>Status</Th>
                      <Th>Given</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {consents.records.map((c) => (
                      <Tr key={c.id}>
                        <Td>{c.subjectIdentifier}</Td>
                        <Td>{c.purposeTitle}</Td>
                        <Td hideBelow="lg">
                          {c.noticeVersion} · {c.language}
                        </Td>
                        <Td>
                          <Badge tone={c.status === "granted" ? "success" : "neutral"}>{c.status}</Badge>
                        </Td>
                        <Td>{fmt(c.grantedAt)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableContainer>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "retention" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Retention periods" description="Applied daily. Storage limitation (GDPR Art. 5(1)(e), DPDP s.8(7)); the audit trail is never kept less than a year." />
            <CardBody>
              <ul className="space-y-4">
                {RETENTION_CATEGORIES.map((c) => {
                  const p = policies.find((x) => x.dataCategory === c.key);
                  return (
                    <li key={c.key} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{c.label}</span>
                        {p?.enabled ? <Badge tone="success">{p.retentionDays} days</Badge> : <Badge>Not set</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {c.description}
                        {p?.lastRunAt ? ` Last run ${fmt(p.lastRunAt)}: ${p.lastRunAffected ?? 0} affected.` : ""}
                      </p>
                      {can("privacy.manage") ? (
                        <PrivacyForm action={saveRetentionPolicyAction} submitLabel="Save" pendingLabel="Saving…" variant="outline" className="flex flex-wrap items-end gap-2 space-y-0">
                          <input type="hidden" name="category" value={c.key} />
                          <div>
                            <label htmlFor={`rt-${c.key}`} className="sr-only">
                              Days
                            </label>
                            <input id={`rt-${c.key}`} name="days" type="number" min={c.minDays} max={36500} defaultValue={p?.retentionDays ?? Math.max(c.minDays, 365)} className={`${fieldInputClass} w-28`} />
                          </div>
                          <label className="flex items-center gap-1.5 text-sm">
                            <input type="checkbox" name="enabled" defaultChecked={p?.enabled ?? true} /> Enabled
                          </label>
                        </PrivacyForm>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Legal holds" description="While a hold is active, retention deletes nothing it covers (litigation, regulator, investigation)." />
            <CardBody className="space-y-4">
              {holds.length === 0 ? (
                <EmptyState title="No legal holds" />
              ) : (
                <ul className="divide-y divide-border">
                  {holds.map((h) => (
                    <li key={h.id} className="py-2">
                      <span className="font-medium text-foreground">{h.name}</span> {h.releasedAt ? <Badge>Released {fmt(h.releasedAt)}</Badge> : <Badge tone="warning">Active</Badge>}
                      <p className="text-xs text-muted-foreground">
                        {h.dataCategories.join(", ")} · {h.reason}
                      </p>
                      {!h.releasedAt && can("privacy.manage") ? (
                        <form action={releaseLegalHoldAction.bind(null, h.id)}>
                          <button type="submit" className="text-xs text-primary hover:underline">
                            Release
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {can("privacy.manage") ? (
                <PrivacyForm action={placeLegalHoldAction} submitLabel="Place hold" pendingLabel="Placing…">
                  <Text name="name" label="Name" required />
                  <Text name="reason" label="Reason" required />
                  <fieldset>
                    <legend className={fieldLabelClass}>Covers</legend>
                    <div className="grid grid-cols-2 gap-1 text-sm">
                      {RETENTION_CATEGORIES.map((c) => (
                        <label key={c.key} className="flex items-center gap-1.5">
                          <input type="checkbox" name="categories" value={c.key} /> {c.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </PrivacyForm>
              ) : null}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "contacts" ? (
        <Card>
          <CardHeader title="Contacts and applicable laws" description="Published to every member on My privacy (GDPR Art. 13(1)(b), 37(7); DPDP s.8(9))." />
          <CardBody>
            <PrivacyForm action={savePrivacySettingsAction} submitLabel="Save" pendingLabel="Saving…">
              <fieldset>
                <legend className={fieldLabelClass}>Laws that apply to the people you govern</legend>
                <div className="flex flex-wrap gap-3 text-sm">
                  {REGIMES.map((r) => (
                    <label key={r} className="flex items-center gap-1.5">
                      <input type="checkbox" name="regimes" value={r} defaultChecked={settings.regimes.includes(r)} disabled={!can("privacy.manage")} /> {REGIME_LABEL[r]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <Text name="dpoName" label="Data Protection Officer" defaultValue={settings.dpoName} />
                <Text name="dpoEmail" label="DPO email" type="email" defaultValue={settings.dpoEmail} />
                <Text name="grievanceOfficerName" label="Grievance officer (DPDP)" defaultValue={settings.grievanceOfficerName} />
                <Text name="grievanceOfficerEmail" label="Grievance officer email" type="email" defaultValue={settings.grievanceOfficerEmail} />
                <Text name="grievanceOfficerPhone" label="Grievance officer phone" defaultValue={settings.grievanceOfficerPhone} />
                <Text name="euRepresentative" label="EU / UK representative (Art. 27)" defaultValue={settings.euRepresentative} />
                <Text name="supervisoryAuthority" label="Lead supervisory authority" defaultValue={settings.supervisoryAuthority} />
                <Text name="privacyNoticeUrl" label="Privacy notice URL" defaultValue={settings.privacyNoticeUrl} placeholder="https://" />
                <Text name="privacyNoticeVersion" label="Privacy notice version" defaultValue={settings.privacyNoticeVersion} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="significantDataFiduciary" defaultChecked={settings.significantDataFiduciary} /> Notified as a Significant Data Fiduciary (DPDP s.10: annual DPIA and independent audit)
              </label>
            </PrivacyForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
