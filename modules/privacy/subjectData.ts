import "server-only";

import { createHash } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { changeUserStatus } from "@/lib/users/users";
import { pseudonymiseWriteTarget, pseudonymLabel } from "./rules";

/**
 * COMPLIANCE-P0-12 — what WonderID holds about one person in ONE tenant
 * (the tenant is the controller / Data Fiduciary; another tenant the same
 * person belongs to is a separate controller and is never touched or
 * disclosed — non-negotiable #4, #16).
 *
 * Every query is a service-role read filtered by the server-resolved
 * tenantId (§14), run only after the caller passed privacy.requests.process
 * or proved they are the subject.
 */

const db = () => supabaseServiceRole();

/** Escapes LIKE wildcards so an address with "_" or "%" only ever matches itself. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Ids of `table` rows in this tenant that belong to the subject: matched on
 * the user id and, separately, on the email — never through a string-built
 * PostgREST `or` filter, so a crafted address cannot widen the match.
 */
async function subjectRowIds(
  table: "identities" | "privacy_consent_records" | "privacy_requests",
  tenantId: string,
  subject: { userId: string | null; email: string },
): Promise<string[]> {
  const supabase = db();
  const userColumn = table === "identities" ? "user_id" : "subject_user_id";
  const emailColumn = table === "identities" ? "email" : table === "privacy_consent_records" ? "subject_identifier" : "subject_email";
  const queries = [supabase.from(table).select("id").eq("tenant_id", tenantId).ilike(emailColumn, escapeLike(subject.email))];
  if (subject.userId) queries.push(supabase.from(table).select("id").eq("tenant_id", tenantId).eq(userColumn, subject.userId));
  const results = await Promise.all(queries);
  for (const r of results) if (r.error) throw new ApiError(500, "QUERY_FAILED", r.error.message);
  return [...new Set(results.flatMap((r) => (r.data ?? []).map((row: { id: string }) => row.id)))];
}

export function subjectHash(tenantId: string, identifier: string): string {
  return createHash("sha256").update(`${tenantId}:${identifier.trim().toLowerCase()}`).digest("hex");
}

export type SubjectRef = { userId: string | null; email: string };

/** GDPR Art. 15 / 20, DPDP s.11, CCPA §1798.110: a structured, machine-readable copy. */
export async function buildSubjectExport(tenantId: string, subject: SubjectRef): Promise<Record<string, unknown>> {
  const supabase = db();
  const email = subject.email.trim().toLowerCase();
  const userId = subject.userId;

  const [identityIds, consentIds, requestIds] = await Promise.all([
    subjectRowIds("identities", tenantId, { userId, email }),
    subjectRowIds("privacy_consent_records", tenantId, { userId, email }),
    subjectRowIds("privacy_requests", tenantId, { userId, email }),
  ]);
  const none = ["00000000-0000-0000-0000-000000000000"];

  const [tenant, user, membership, roles, groups, identities, consents, requests, notifications, auditEvents] = await Promise.all([
    supabase.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle(),
    userId ? supabase.from("users").select("id, email, display_name, created_at").eq("id", userId).maybeSingle() : Promise.resolve({ data: null }),
    userId
      ? supabase.from("tenant_memberships").select("status, created_at, account_type, auth_method, invited_at, status_changed_at").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId ? supabase.from("user_roles").select("created_at, scope_type, scope_values, starts_at, expires_at, roles(name, display_name)").eq("tenant_id", tenantId).eq("user_id", userId) : Promise.resolve({ data: [] }),
    userId ? supabase.from("group_members").select("created_at, groups(name)").eq("tenant_id", tenantId).eq("user_id", userId) : Promise.resolve({ data: [] }),
    supabase
      .from("identities")
      .select("id, identity_type, display_name, username, email, status, lifecycle_state, department, title, business_unit, location, employment_type, organization, start_date, end_date, attributes, source_system, created_at, updated_at, last_seen_at")
      .eq("tenant_id", tenantId)
      .in("id", identityIds.length ? identityIds : none),
    supabase
      .from("privacy_consent_records")
      .select("notice_version, language, channel, status, granted_at, withdrawn_at, privacy_consent_purposes(key, title)")
      .eq("tenant_id", tenantId)
      .in("id", consentIds.length ? consentIds : none),
    supabase
      .from("privacy_requests")
      .select("reference, regime, request_type, status, received_at, due_at, completed_at, outcome")
      .eq("tenant_id", tenantId)
      .in("id", requestIds.length ? requestIds : none),
    userId ? supabase.from("notifications").select("type, title, body, created_at, read_at").eq("tenant_id", tenantId).eq("user_id", userId).order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    userId ? supabase.from("audit_logs").select("action, object_type, object_id, outcome, created_at").eq("tenant_id", tenantId).eq("actor_id", userId).order("created_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [] }),
  ]);

  const accounts = identityIds.length
    ? await supabase.from("accounts").select("account_name, account_type, status, last_used_at, last_seen_at, created_at, applications(name)").eq("tenant_id", tenantId).in("identity_id", identityIds)
    : { data: [] };
  const accessRequests = identityIds.length
    ? await supabase.from("access_requests").select("request_type, status, justification, created_at, decided_at").eq("tenant_id", tenantId).in("subject_identity_id", identityIds).limit(500)
    : { data: [] };

  return {
    format: "wonderid.subject-export.v1",
    generatedAt: new Date().toISOString(),
    controller: { organization: tenant.data?.name ?? null, address: tenant.data?.slug ?? null },
    subject: { email, userId },
    account: user.data ? { email: user.data.email, displayName: user.data.display_name, createdAt: user.data.created_at } : null,
    membership: membership.data ?? null,
    roles: roles.data ?? [],
    groups: groups.data ?? [],
    identityRecords: identities.data ?? [],
    applicationAccounts: accounts.data ?? [],
    accessRequests: accessRequests.data ?? [],
    consents: consents.data ?? [],
    privacyRequests: requests.data ?? [],
    notifications: notifications.data ?? [],
    activity: { note: "Your own actions recorded in this organization's audit trail (latest 1,000).", events: auditEvents.data ?? [] },
    retainedUnderLegalObligation: [
      "The organization's audit trail is append-only and hash-chained; entries about you are kept for the organization's audit retention period (GDPR Art. 17(3)(b), DPDP s.8(7)).",
    ],
  };
}

/** The identity types that are a person: staff, and guests, partners or contractors. */
const PERSON_TYPES = ["HUMAN", "EXTERNAL"];

/**
 * WID-H07 (owner decision "identifiers only", 12 October 2026): the records
 * outside the identity that name the person.
 * - Account names become the pseudonym. Each account's reference in its
 *   system stays: the account still exists there, and its access stays
 *   governed until the system removes it.
 * - The values sources sent about the person (change history,
 *   disagreements) are deleted; undo is not possible after erasure.
 * - Connector writes keep their outcome; the email, login and name they
 *   were sent become the pseudonym.
 * A source or system that still holds the person sends them again at its
 * next import, so the summary counts what is still held there: the
 * organization erases it at the source (the source is the system of record,
 * non-negotiable #7).
 */
async function eraseLinkedRecords(
  tenantId: string,
  identityIds: string[],
  emails: string[],
  usernames: string[],
  label: string,
): Promise<Record<string, unknown>> {
  const supabase = db();
  const ids = identityIds.length ? identityIds : ["00000000-0000-0000-0000-000000000000"];
  const fail = (what: string, message: string) => new ApiError(500, "ERASURE_FAILED", `${what} could not be erased: ${message}`);

  const [accounts, changes, conflicts] = await Promise.all([
    supabase.from("accounts").update({ account_name: label, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).in("identity_id", ids).select("id, status, missing_from_source_at"),
    supabase.from("identity_source_changes").delete({ count: "exact" }).eq("tenant_id", tenantId).in("identity_id", ids),
    supabase.from("identity_source_conflicts").delete({ count: "exact" }).eq("tenant_id", tenantId).in("identity_id", ids),
  ]);
  if (accounts.error) throw fail("Accounts", accounts.error.message);
  if (changes.error) throw fail("Source change history", changes.error.message);
  if (conflicts.error) throw fail("Source disagreements", conflicts.error.message);

  // Connector writes that named the person (a new account's email or login).
  const lookups = [
    ...emails.map((e) => supabase.from("connector_write_operations").select("id, target").eq("tenant_id", tenantId).ilike("target->>email", escapeLike(e))),
    ...(usernames.length ? [supabase.from("connector_write_operations").select("id, target").eq("tenant_id", tenantId).in("target->>username", usernames)] : []),
  ];
  const found = await Promise.all(lookups);
  const writes = new Map<string, Record<string, unknown>>();
  for (const r of found) {
    if (r.error) throw fail("Connector writes", r.error.message);
    for (const row of (r.data ?? []) as { id: string; target: Record<string, unknown> }[]) writes.set(row.id, row.target ?? {});
  }
  const updated = await Promise.all(
    [...writes].map(([id, target]) =>
      supabase.from("connector_write_operations").update({ target: pseudonymiseWriteTarget(target, label) }).eq("tenant_id", tenantId).eq("id", id),
    ),
  );
  const writeError = updated.find((r) => r.error)?.error;
  if (writeError) throw fail("Connector writes", writeError.message);

  const { count: sourceRecords, error: linkError } = await supabase
    .from("identity_source_links")
    .select("identity_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("present", true)
    .in("identity_id", ids);
  if (linkError) throw fail("Source records", linkError.message);

  const accountRows = (accounts.data ?? []) as { status: string; missing_from_source_at: string | null }[];
  return {
    accountsPseudonymised: accountRows.length,
    sourceValuesDeleted: (changes.count ?? 0) + (conflicts.count ?? 0),
    connectorWritesPseudonymised: writes.size,
    stillHeldAtSource: {
      sourceRecords: sourceRecords ?? 0,
      accounts: accountRows.filter((a) => a.status !== "disabled" && !a.missing_from_source_at).length,
    },
  };
}

/**
 * Erasure (GDPR Art. 17, DPDP s.12(3), CCPA §1798.105) inside one tenant.
 * Pseudonymises rather than hard-deletes where a record must survive for a
 * legal obligation or for the integrity of the governance evidence (the
 * audit trail is never altered: Art. 17(3)(b)/(e), DPDP s.8(7) proviso).
 * The account itself is pseudonymised and blocked only when the person
 * belongs to no other organization; otherwise only this tenant's data is
 * touched.
 */
export async function eraseSubject(
  tenantId: string,
  approverId: string,
  subject: SubjectRef,
  requestId: string,
): Promise<Record<string, unknown>> {
  const supabase = db();
  const email = subject.email.trim().toLowerCase();
  const label = pseudonymLabel(subjectHash(tenantId, subject.userId ?? email));
  const summary: Record<string, unknown> = { pseudonym: label };

  if (subject.userId) {
    // 1. End the membership through Foundation's own lifecycle path (its
    //    guards — last administrator, self-change — still apply).
    const { data: m } = await supabase.from("tenant_memberships").select("status").eq("tenant_id", tenantId).eq("user_id", subject.userId).maybeSingle();
    if (m && m.status !== "removed") {
      await changeUserStatus(tenantId, approverId, subject.userId, "remove", `Erasure request ${requestId}`);
      summary.membership = "removed";
    }
    // 2. Tenant-scoped personal data about the user.
    const [n, np] = await Promise.all([
      supabase.from("notifications").delete({ count: "exact" }).eq("tenant_id", tenantId).eq("user_id", subject.userId),
      supabase.from("notification_preferences").delete({ count: "exact" }).eq("tenant_id", tenantId).eq("user_id", subject.userId),
    ]);
    if (n.error || np.error) throw new ApiError(500, "ERASURE_FAILED", "Notifications could not be erased; nothing was reported as done.");
    summary.notificationsDeleted = (n.count ?? 0) + (np.count ?? 0);
  }

  // 3. Identity records: personal attributes cleared, the governance record
  //    (that an identity held access, and its decisions) kept, pseudonymous.
  //    People only: a staff member (HUMAN) or a guest, partner or contractor
  //    (EXTERNAL). Their emails and logins are read first, to find the
  //    connector writes that named them (step 3b).
  const candidateIds = await subjectRowIds("identities", tenantId, { userId: subject.userId, email });
  const { data: people, error: peopleError } = candidateIds.length
    ? await supabase.from("identities").select("id, email, username").eq("tenant_id", tenantId).in("identity_type", PERSON_TYPES).in("id", candidateIds)
    : { data: [] as { id: string; email: string | null; username: string | null }[], error: null };
  if (peopleError) throw new ApiError(500, "ERASURE_FAILED", `Identity records could not be read: ${peopleError.message}`);
  const identityIds = (people ?? []).map((p) => p.id);
  const emails = [...new Set([email, ...(people ?? []).map((p) => p.email?.trim().toLowerCase()).filter((e): e is string => !!e)])];
  const usernames = [...new Set((people ?? []).map((p) => p.username?.trim()).filter((u): u is string => !!u))];
  const { data: ids, error: idError } = await supabase
    .from("identities")
    .update({
      display_name: label,
      email: null,
      username: null,
      source_native_id: null,
      correlation_key: null,
      department: null,
      title: null,
      business_unit: null,
      location: null,
      employment_type: null,
      organization: null,
      purpose: null,
      start_date: null,
      end_date: null,
      attributes: {},
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .in("identity_type", PERSON_TYPES)
    .in("id", identityIds.length ? identityIds : ["00000000-0000-0000-0000-000000000000"])
    .select("id");
  if (idError) throw new ApiError(500, "ERASURE_FAILED", `Identity records could not be erased: ${idError.message}`);
  summary.identitiesPseudonymised = ids?.length ?? 0;

  // 3b. WID-H07: the other records that name the person.
  Object.assign(summary, await eraseLinkedRecords(tenantId, identityIds, emails, usernames, label));

  // 4. Consent and earlier request records: kept as proof, identifier pseudonymised.
  const consentIds = await subjectRowIds("privacy_consent_records", tenantId, { userId: subject.userId, email });
  let consentsPseudonymised = 0;
  if (consentIds.length) {
    await supabase.from("privacy_consent_records").update({ status: "withdrawn", withdrawn_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("status", "granted").in("id", consentIds);
    const { data: consents, error } = await supabase.from("privacy_consent_records").update({ subject_identifier: label, subject_user_id: null, evidence: {} }).eq("tenant_id", tenantId).in("id", consentIds).select("id");
    if (error) throw new ApiError(500, "ERASURE_FAILED", `Consent records could not be erased: ${error.message}`);
    consentsPseudonymised = consents?.length ?? 0;
  }
  summary.consentsPseudonymised = consentsPseudonymised;
  const priorIds = (await subjectRowIds("privacy_requests", tenantId, { userId: subject.userId, email })).filter((id) => id !== requestId);
  const { data: priorRequests } = priorIds.length
    ? await supabase.from("privacy_requests").update({ subject_email: label, subject_name: null, description: null }).eq("tenant_id", tenantId).in("id", priorIds).select("id")
    : { data: [] as { id: string }[] };
  summary.priorRequestsPseudonymised = priorRequests?.length ?? 0;

  // 5. The global account, only when no other organization still has the person.
  if (subject.userId) {
    const { count } = await supabase.from("tenant_memberships").select("id", { count: "exact", head: true }).eq("user_id", subject.userId).neq("status", "removed");
    if ((count ?? 0) === 0) {
      const erasedEmail = `${label}@erased.invalid`;
      const { error: userError } = await supabase.from("users").update({ email: erasedEmail, display_name: null }).eq("id", subject.userId);
      const { error: authError } = await supabase.auth.admin.updateUserById(subject.userId, { email: erasedEmail, email_confirm: true, user_metadata: {}, ban_duration: "876000h" });
      if (userError || authError) throw new ApiError(500, "ERASURE_FAILED", "The sign-in account could not be erased; the request stays open.");
      summary.account = "pseudonymised_and_blocked";
    } else {
      summary.account = "kept: the person belongs to another organization";
    }
  }

  await writeAudit({
    tenantId,
    actorId: approverId,
    actorType: "user",
    action: "privacy.subject_erased",
    objectType: "privacy_request",
    objectId: requestId,
    outcome: "success",
    // No email or name here: the audit trail is immutable, so it must not take the personal data being erased.
    metadata: { ...summary },
  });
  return summary;
}

/**
 * Retention for removed members: the same pseudonymisation, without the
 * membership step. A member already pseudonymised is skipped, so the daily
 * run does no work twice.
 */
export async function pseudonymiseRemovedMember(tenantId: string, userId: string): Promise<number> {
  const supabase = db();
  const label = pseudonymLabel(subjectHash(tenantId, userId));
  const { data: people, error } = await supabase
    .from("identities")
    .select("id, email, username")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .in("identity_type", PERSON_TYPES)
    .neq("display_name", label);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  if (!people?.length) return 0;
  const identityIds = people.map((p) => p.id);
  const { data } = await supabase
    .from("identities")
    .update({ display_name: label, email: null, username: null, source_native_id: null, correlation_key: null, attributes: {}, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .in("id", identityIds)
    .select("id");
  const emails = [...new Set(people.map((p) => p.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
  const usernames = [...new Set(people.map((p) => p.username?.trim()).filter((u): u is string => !!u))];
  await eraseLinkedRecords(tenantId, identityIds, emails, usernames, label);
  return data?.length ?? 0;
}
