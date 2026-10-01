import "server-only";

import { createHash } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { changeUserStatus } from "@/lib/users/users";
import { pseudonymLabel } from "./rules";

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
  const identityIds = await subjectRowIds("identities", tenantId, { userId: subject.userId, email });
  const { data: ids, error: idError } = await supabase
    .from("identities")
    .update({
      display_name: label,
      email: null,
      username: null,
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
    .eq("identity_type", "HUMAN")
    .in("id", identityIds.length ? identityIds : ["00000000-0000-0000-0000-000000000000"])
    .select("id");
  if (idError) throw new ApiError(500, "ERASURE_FAILED", `Identity records could not be erased: ${idError.message}`);
  summary.identitiesPseudonymised = ids?.length ?? 0;

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

/** Retention for removed members: the same pseudonymisation, without the membership step. */
export async function pseudonymiseRemovedMember(tenantId: string, userId: string): Promise<number> {
  const supabase = db();
  const label = pseudonymLabel(subjectHash(tenantId, userId));
  const { data } = await supabase
    .from("identities")
    .update({ display_name: label, email: null, username: null, attributes: {}, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("identity_type", "HUMAN")
    .neq("display_name", label)
    .select("id");
  return data?.length ?? 0;
}
