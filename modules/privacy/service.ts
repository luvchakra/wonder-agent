import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { listPermissionHolders } from "@/lib/rbac/permissionHolders";
import { notify, wasRecentlyNotified } from "@/modules/operations/notifications";
import {
  REGIME_REQUEST_TYPES,
  REGIMES,
  RETENTION_CATEGORIES,
  breachObligations,
  canTransition,
  checkExtension,
  closeBreachRefusal,
  deadlineState,
  minRetentionDays,
  pseudonymLabel,
  requestReference,
  requiresApproval,
  requiresVerification,
  responseDueAt,
  retentionCutoff,
  type Regime,
  type RequestStatus,
  type RequestType,
  type RetentionCategory,
} from "./rules";
import { buildSubjectExport, eraseSubject, pseudonymiseRemovedMember, subjectHash } from "./subjectData";
import type { BreachIncident, ConsentPurpose, ConsentRecord, LawfulBasis, LegalHold, PrivacyRequest, PrivacySettings, ProcessingActivity, RetentionPolicy, TransferMechanism } from "./types";

/**
 * COMPLIANCE-P0-12 — the privacy programme service (GDPR / UK GDPR / DPDP /
 * CCPA). Every function takes the server-resolved tenant (§14) and an actor
 * that has already passed requirePermission() for the matching key
 * (privacy.view, privacy.manage, privacy.requests.process,
 * privacy.incidents.manage), or — for the self-service functions — is the
 * subject themselves. Reads use the member's client so RLS applies again;
 * writes use the service role filtered to the tenant, and every change is
 * audited (non-negotiable #11) without copying personal data into the
 * immutable audit trail.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

const db = () => supabaseServiceRole();
const EMAIL_RE = /^[^@\s,()]+@[^@\s,()]+\.[^@\s,()]+$/;
const now = () => new Date();

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
function list(v: unknown, max = 30): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].slice(0, max).map((x) => x.slice(0, 100));
}
const httpsUrl = (v: string | null) => (v && /^https:\/\/[^\s]+$/.test(v) ? v : null);

async function audit(tenantId: string, actorId: string | null, action: string, objectType: string, objectId: string, metadata: Record<string, unknown> = {}, outcome: "success" | "failure" = "success") {
  await writeAudit({ tenantId, actorId, actorType: actorId ? "user" : "system", action, objectType, objectId, outcome, metadata });
}

// ================================================================ settings

function toSettings(row: any, tenantId: string): PrivacySettings {
  return {
    tenantId,
    regimes: row?.regimes ?? ["gdpr", "dpdp"],
    dpoName: row?.dpo_name ?? null,
    dpoEmail: row?.dpo_email ?? null,
    grievanceOfficerName: row?.grievance_officer_name ?? null,
    grievanceOfficerEmail: row?.grievance_officer_email ?? null,
    grievanceOfficerPhone: row?.grievance_officer_phone ?? null,
    euRepresentative: row?.eu_representative ?? null,
    supervisoryAuthority: row?.supervisory_authority ?? null,
    privacyNoticeUrl: row?.privacy_notice_url ?? null,
    privacyNoticeVersion: row?.privacy_notice_version ?? null,
    significantDataFiduciary: !!row?.significant_data_fiduciary,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getPrivacySettings(tenantId: string): Promise<PrivacySettings> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_settings").select().eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return toSettings(data, tenantId);
}

/** The contacts a member needs to exercise their rights (any member may read these; DPDP s.8(9) requires them published). */
export async function getPrivacyContacts(tenantId: string): Promise<Pick<PrivacySettings, "dpoName" | "dpoEmail" | "grievanceOfficerName" | "grievanceOfficerEmail" | "grievanceOfficerPhone" | "privacyNoticeUrl" | "regimes">> {
  const { data } = await db().from("privacy_settings").select("dpo_name, dpo_email, grievance_officer_name, grievance_officer_email, grievance_officer_phone, privacy_notice_url, regimes").eq("tenant_id", tenantId).maybeSingle();
  const s = toSettings(data, tenantId);
  return { dpoName: s.dpoName, dpoEmail: s.dpoEmail, grievanceOfficerName: s.grievanceOfficerName, grievanceOfficerEmail: s.grievanceOfficerEmail, grievanceOfficerPhone: s.grievanceOfficerPhone, privacyNoticeUrl: s.privacyNoticeUrl, regimes: s.regimes };
}

export async function savePrivacySettings(tenantId: string, actorId: string, raw: Record<string, unknown>): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const regimes = list(raw.regimes).filter((r): r is Regime => (REGIMES as string[]).includes(r));
  if (!regimes.length) errors.regimes = "Choose at least one law that applies.";
  const dpoEmail = str(raw.dpoEmail, 320)?.toLowerCase() ?? null;
  const goEmail = str(raw.grievanceOfficerEmail, 320)?.toLowerCase() ?? null;
  if (dpoEmail && !EMAIL_RE.test(dpoEmail)) errors.dpoEmail = "Enter a valid email.";
  if (goEmail && !EMAIL_RE.test(goEmail)) errors.grievanceOfficerEmail = "Enter a valid email.";
  const noticeUrlRaw = str(raw.privacyNoticeUrl, 500);
  const noticeUrl = httpsUrl(noticeUrlRaw);
  if (noticeUrlRaw && !noticeUrl) errors.privacyNoticeUrl = "Use an https:// address.";
  if (regimes.includes("dpdp") && !(goEmail || dpoEmail)) errors.grievanceOfficerEmail = "DPDP requires a published contact for grievances (s.8(9)).";
  if (Object.keys(errors).length) return { ok: false, errors };
  const { error } = await db()
    .from("privacy_settings")
    .upsert(
      {
        tenant_id: tenantId,
        regimes,
        dpo_name: str(raw.dpoName, 200),
        dpo_email: dpoEmail,
        grievance_officer_name: str(raw.grievanceOfficerName, 200),
        grievance_officer_email: goEmail,
        grievance_officer_phone: str(raw.grievanceOfficerPhone, 40),
        eu_representative: str(raw.euRepresentative, 500),
        supervisory_authority: str(raw.supervisoryAuthority, 200),
        privacy_notice_url: noticeUrl,
        privacy_notice_version: str(raw.privacyNoticeVersion, 40),
        significant_data_fiduciary: raw.significantDataFiduciary === true || raw.significantDataFiduciary === "on",
        updated_by: actorId,
        updated_at: now().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
  if (error) throw new ApiError(500, "SAVE_FAILED", error.message);
  await audit(tenantId, actorId, "privacy.settings_updated", "privacy_settings", tenantId, { regimes });
  return { ok: true };
}

// ================================================================ records of processing (Art. 30)

const LAWFUL_BASES: LawfulBasis[] = ["consent", "contract", "legal_obligation", "vital_interests", "public_task", "legitimate_interests", "dpdp_consent", "dpdp_legitimate_use"];
const TRANSFER_MECHANISMS: TransferMechanism[] = ["none", "adequacy", "sccs", "bcrs", "derogation", "dpdp_permitted"];

function toActivity(r: any): ProcessingActivity {
  return {
    id: r.id,
    name: r.name,
    purpose: r.purpose,
    lawfulBasis: r.lawful_basis,
    dataCategories: r.data_categories ?? [],
    specialCategories: r.special_categories,
    subjectCategories: r.subject_categories ?? [],
    recipients: r.recipients ?? [],
    transferCountries: r.transfer_countries ?? [],
    transferMechanism: r.transfer_mechanism,
    retentionDays: r.retention_days,
    securityMeasures: r.security_measures,
    dpiaRequired: r.dpia_required,
    dpiaCompletedAt: r.dpia_completed_at,
    status: r.status,
    updatedAt: r.updated_at,
  };
}

export async function listProcessingActivities(tenantId: string): Promise<ProcessingActivity[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_processing_activities").select().eq("tenant_id", tenantId).order("status").order("name").limit(500);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toActivity);
}

export async function saveProcessingActivity(tenantId: string, actorId: string, id: string | null, raw: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const name = str(raw.name, 200);
  const purpose = str(raw.purpose, 2000);
  const lawfulBasis = str(raw.lawfulBasis, 40) as LawfulBasis | null;
  const transferCountries = list(raw.transferCountries).map((c) => c.toUpperCase());
  const transferMechanism = (str(raw.transferMechanism, 40) ?? "none") as TransferMechanism;
  const retention = str(raw.retentionDays, 6);
  const retentionDays = retention ? Number(retention) : null;
  if (!name || name.length < 2) errors.name = "Name the processing activity.";
  if (!purpose) errors.purpose = "State the purpose.";
  if (!lawfulBasis || !LAWFUL_BASES.includes(lawfulBasis)) errors.lawfulBasis = "Choose the lawful basis.";
  if (!TRANSFER_MECHANISMS.includes(transferMechanism)) errors.transferMechanism = "Choose the transfer safeguard.";
  if (transferCountries.some((c) => !/^[A-Z]{2}$/.test(c))) errors.transferCountries = "Use two-letter country codes, comma separated.";
  else if (transferCountries.length && transferMechanism === "none") errors.transferMechanism = "Cross-border transfers need a safeguard (GDPR Art. 44-46).";
  if (retentionDays !== null && (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500)) errors.retentionDays = "Enter days between 1 and 36500.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const row = {
    tenant_id: tenantId,
    name,
    purpose,
    lawful_basis: lawfulBasis,
    data_categories: list(raw.dataCategories),
    special_categories: raw.specialCategories === true || raw.specialCategories === "on",
    subject_categories: list(raw.subjectCategories),
    recipients: list(raw.recipients),
    transfer_countries: transferCountries,
    transfer_mechanism: transferMechanism,
    retention_days: retentionDays,
    security_measures: str(raw.securityMeasures, 4000),
    dpia_required: raw.dpiaRequired === true || raw.dpiaRequired === "on",
    dpia_completed_at: str(raw.dpiaCompletedAt, 40) ? new Date(String(raw.dpiaCompletedAt)).toISOString() : null,
    updated_at: now().toISOString(),
  };
  const supabase = db();
  const { data, error } = id
    ? await supabase.from("privacy_processing_activities").update(row).eq("id", id).eq("tenant_id", tenantId).select("id").maybeSingle()
    : await supabase.from("privacy_processing_activities").insert({ ...row, created_by: actorId, owner_id: actorId }).select("id").single();
  if (error) throw new ApiError(500, "SAVE_FAILED", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "No such processing activity");
  await audit(tenantId, actorId, id ? "privacy.ropa_updated" : "privacy.ropa_created", "processing_activity", data.id, { lawfulBasis, transfers: transferCountries.length });
  return { ok: true, id: data.id };
}

export async function setProcessingActivityStatus(tenantId: string, actorId: string, id: string, status: "active" | "retired"): Promise<void> {
  const { data, error } = await db().from("privacy_processing_activities").update({ status, updated_at: now().toISOString() }).eq("id", id).eq("tenant_id", tenantId).select("id").maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "No such processing activity");
  await audit(tenantId, actorId, `privacy.ropa_${status}`, "processing_activity", id);
}

// ================================================================ consent (GDPR Art. 7, DPDP s.6)

const toPurpose = (r: any): ConsentPurpose => ({ id: r.id, key: r.key, title: r.title, description: r.description, noticeVersion: r.notice_version, active: r.active });
const toConsent = (r: any): ConsentRecord => ({
  id: r.id,
  purposeId: r.purpose_id,
  subjectUserId: r.subject_user_id,
  subjectIdentifier: r.subject_identifier,
  noticeVersion: r.notice_version,
  language: r.language,
  channel: r.channel,
  status: r.status,
  grantedAt: r.granted_at,
  withdrawnAt: r.withdrawn_at,
});

export async function listConsentPurposes(tenantId: string, activeOnly = false): Promise<ConsentPurpose[]> {
  const supabase = await supabaseServer();
  let q = supabase.from("privacy_consent_purposes").select().eq("tenant_id", tenantId).order("title");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPurpose);
}

export async function saveConsentPurpose(tenantId: string, actorId: string, raw: Record<string, unknown>): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const id = str(raw.id, 40);
  const key = str(raw.key, 60)?.toLowerCase() ?? null;
  const title = str(raw.title, 200);
  const description = str(raw.description, 4000);
  const noticeVersion = str(raw.noticeVersion, 40);
  if (!id && (!key || !/^[a-z][a-z0-9_]{1,59}$/.test(key))) errors.key = "Use lowercase letters, digits and underscores.";
  if (!title || title.length < 2) errors.title = "Give the purpose a title.";
  if (!description || description.length < 10) errors.description = "Describe the purpose in plain language (at least 10 characters).";
  if (!noticeVersion) errors.noticeVersion = "Give the notice version.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const supabase = db();
  if (id) {
    const { data: prev } = await supabase.from("privacy_consent_purposes").select().eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!prev) throw new ApiError(404, "NOT_FOUND", "No such consent purpose");
    // A changed purpose text is a new notice: consent given to the old text does not cover it.
    if ((prev.description !== description || prev.title !== title) && prev.notice_version === noticeVersion) {
      return { ok: false, errors: { noticeVersion: "The wording changed, so give it a new notice version; existing consents stay tied to the old one." } };
    }
    const { error } = await supabase
      .from("privacy_consent_purposes")
      .update({ title, description, notice_version: noticeVersion, active: raw.active === undefined ? prev.active : raw.active === true || raw.active === "on", updated_at: now().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new ApiError(500, "SAVE_FAILED", error.message);
    await audit(tenantId, actorId, "privacy.consent_purpose_updated", "consent_purpose", id, { noticeVersion });
  } else {
    const { data, error } = await supabase.from("privacy_consent_purposes").insert({ tenant_id: tenantId, key, title, description, notice_version: noticeVersion, created_by: actorId }).select("id").single();
    if (error?.code === "23505") return { ok: false, errors: { key: "That key is already used." } };
    if (error || !data) throw new ApiError(500, "SAVE_FAILED", error?.message ?? "Failed to save");
    await audit(tenantId, actorId, "privacy.consent_purpose_created", "consent_purpose", data.id, { key, noticeVersion });
  }
  return { ok: true };
}

export async function listConsentRecords(tenantId: string, opts: { limit?: number; offset?: number } = {}): Promise<{ records: (ConsentRecord & { purposeTitle: string })[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const supabase = await supabaseServer();
  const { data, error, count } = await supabase
    .from("privacy_consent_records")
    .select("*, privacy_consent_purposes(title)", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("granted_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return { records: (data ?? []).map((r: any) => ({ ...toConsent(r), purposeTitle: r.privacy_consent_purposes?.title ?? "" })), total: count ?? 0 };
}

export async function listMyConsents(tenantId: string, userId: string): Promise<ConsentRecord[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_consent_records").select().eq("tenant_id", tenantId).eq("subject_user_id", userId).order("granted_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toConsent);
}

async function memberEmail(tenantId: string, userId: string): Promise<string> {
  const supabase = db();
  const [{ data: m }, { data: u }] = await Promise.all([
    supabase.from("tenant_memberships").select("status").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
    supabase.from("users").select("email").eq("id", userId).maybeSingle(),
  ]);
  if (!m || m.status !== "active" || !u?.email) throw new ApiError(403, "NOT_A_MEMBER", "Only an active member can do this");
  return String(u.email).toLowerCase();
}

/** The subject grants consent to a purpose, on the current notice version, in their language. */
export async function grantMyConsent(tenantId: string, userId: string, purposeId: string, language: string, evidence: { userAgent: string | null }): Promise<void> {
  const email = await memberEmail(tenantId, userId);
  const supabase = db();
  const { data: purpose } = await supabase.from("privacy_consent_purposes").select().eq("id", purposeId).eq("tenant_id", tenantId).eq("active", true).maybeSingle();
  if (!purpose) throw new ApiError(404, "NOT_FOUND", "That consent purpose is not offered");
  const lang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language) ? language : "en";
  const { data, error } = await supabase
    .from("privacy_consent_records")
    .insert({ tenant_id: tenantId, purpose_id: purposeId, subject_user_id: userId, subject_identifier: email, notice_version: purpose.notice_version, language: lang, channel: "web", recorded_by: userId, evidence: { userAgent: evidence.userAgent?.slice(0, 300) ?? null } })
    .select("id")
    .single();
  if (error?.code === "23505") return; // already granted: idempotent
  if (error || !data) throw new ApiError(500, "SAVE_FAILED", error?.message ?? "Failed to record consent");
  await audit(tenantId, userId, "privacy.consent_granted", "consent_record", data.id, { purpose: purpose.key, noticeVersion: purpose.notice_version, language: lang });
}

/** Withdrawal is one click, as easy as giving it (GDPR Art. 7(3); DPDP s.6(4)). */
export async function withdrawMyConsent(tenantId: string, userId: string, purposeId: string): Promise<void> {
  const { data, error } = await db()
    .from("privacy_consent_records")
    .update({ status: "withdrawn", withdrawn_at: now().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("purpose_id", purposeId)
    .eq("subject_user_id", userId)
    .eq("status", "granted")
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  for (const row of data ?? []) await audit(tenantId, userId, "privacy.consent_withdrawn", "consent_record", row.id, { purposeId });
}

// ================================================================ rights requests

function toRequest(r: any): PrivacyRequest {
  return {
    id: r.id,
    reference: r.reference,
    regime: r.regime,
    requestType: r.request_type,
    subjectUserId: r.subject_user_id,
    subjectEmail: r.subject_email,
    subjectName: r.subject_name,
    description: r.description,
    channel: r.channel,
    status: r.status,
    receivedAt: r.received_at,
    dueAt: r.due_at,
    extendedDueAt: r.extended_due_at,
    extensionReason: r.extension_reason,
    identityVerifiedAt: r.identity_verified_at,
    verificationMethod: r.verification_method,
    assignedTo: r.assigned_to,
    outcome: r.outcome,
    outcomeReason: r.outcome_reason,
    processedBy: r.processed_by,
    approvedBy: r.approved_by,
    completedAt: r.completed_at,
    result: r.result ?? {},
    createdAt: r.created_at,
  };
}

export async function listRequests(tenantId: string, opts: { status?: string; open?: boolean; limit?: number; offset?: number } = {}): Promise<{ requests: PrivacyRequest[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const supabase = await supabaseServer();
  let q = supabase.from("privacy_requests").select("*", { count: "exact" }).eq("tenant_id", tenantId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.open) q = q.not("status", "in", "(completed,rejected,withdrawn)");
  const { data, error, count } = await q.order("due_at", { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return { requests: (data ?? []).map(toRequest), total: count ?? 0 };
}

export async function getRequest(tenantId: string, id: string): Promise<PrivacyRequest | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_requests").select().eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toRequest(data) : null;
}

export async function listMyRequests(tenantId: string, userId: string): Promise<PrivacyRequest[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_requests").select().eq("tenant_id", tenantId).eq("subject_user_id", userId).order("received_at", { ascending: false }).limit(100);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toRequest);
}

type NewRequest = { regime: string; requestType: string; subjectEmail?: string; subjectName?: string; description?: string; channel?: string; receivedAt?: string };

async function insertRequest(tenantId: string, values: Record<string, unknown>): Promise<PrivacyRequest> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db()
      .from("privacy_requests")
      .insert({ ...values, reference: requestReference("PR", now()) })
      .select()
      .single();
    if (!error && data) return toRequest(data);
    if (error?.code !== "23505") throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to record the request");
  }
  throw new ApiError(500, "CREATE_FAILED", "Could not allocate a request reference");
}

function validateRegimeType(regime: string, requestType: string): { regime: Regime; requestType: RequestType } {
  if (!(REGIMES as string[]).includes(regime)) throw new ApiError(400, "VALIDATION_FAILED", "Choose the law the request is made under");
  if (!REGIME_REQUEST_TYPES[regime as Regime].includes(requestType as RequestType)) throw new ApiError(400, "VALIDATION_FAILED", "That right is not available under the chosen law");
  return { regime: regime as Regime, requestType: requestType as RequestType };
}

/** A member exercises a right themselves. Their signed-in session is the identity verification. */
export async function createMyRequest(tenantId: string, userId: string, input: NewRequest): Promise<PrivacyRequest> {
  const { regime, requestType } = validateRegimeType(String(input.regime ?? ""), String(input.requestType ?? ""));
  const email = await memberEmail(tenantId, userId);
  const { data: u } = await db().from("users").select("display_name").eq("id", userId).maybeSingle();
  const received = now();
  const req = await insertRequest(tenantId, {
    tenant_id: tenantId,
    regime,
    request_type: requestType,
    subject_user_id: userId,
    subject_email: email,
    subject_name: u?.display_name ?? null,
    description: str(input.description, 4000),
    channel: "self_service",
    status: "in_progress",
    received_at: received.toISOString(),
    due_at: responseDueAt(regime, received).toISOString(),
    identity_verified_at: received.toISOString(),
    identity_verified_by: userId,
    verification_method: "Authenticated WonderID session",
    created_by: userId,
  });
  await audit(tenantId, userId, "privacy.request_received", "privacy_request", req.id, { reference: req.reference, regime, requestType, channel: "self_service" });
  await notifyPrivacyStaff(tenantId, "New privacy request", `${req.reference}: ${requestType.replace("_", " ")} under ${regime.toUpperCase()}, due ${req.dueAt.slice(0, 10)}.`, req.id);
  return req;
}

/** Privacy staff log a request received by email, form, phone or post. */
export async function createRequest(tenantId: string, actorId: string, input: NewRequest): Promise<PrivacyRequest> {
  const { regime, requestType } = validateRegimeType(String(input.regime ?? ""), String(input.requestType ?? ""));
  const email = str(input.subjectEmail, 320)?.toLowerCase() ?? null;
  if (!email || !EMAIL_RE.test(email)) throw new ApiError(400, "VALIDATION_FAILED", "Enter the requester's email");
  const channel = ["email", "web_form", "api", "phone", "post", "other"].includes(String(input.channel)) ? String(input.channel) : "email";
  const receivedRaw = str(input.receivedAt, 40);
  const received = receivedRaw ? new Date(receivedRaw) : now();
  if (Number.isNaN(received.getTime()) || received > now()) throw new ApiError(400, "VALIDATION_FAILED", "The received date cannot be in the future");
  // Link to a member of THIS tenant only when the address matches one.
  const { data: member } = await db().from("users").select("id, tenant_memberships!inner(tenant_id)").eq("email", email).eq("tenant_memberships.tenant_id", tenantId).maybeSingle();
  const req = await insertRequest(tenantId, {
    tenant_id: tenantId,
    regime,
    request_type: requestType,
    subject_user_id: member?.id ?? null,
    subject_email: email,
    subject_name: str(input.subjectName, 200),
    description: str(input.description, 4000),
    channel,
    status: "received",
    received_at: received.toISOString(),
    // The clock runs from receipt, not from when it was logged.
    due_at: responseDueAt(regime, received).toISOString(),
    created_by: actorId,
  });
  await audit(tenantId, actorId, "privacy.request_received", "privacy_request", req.id, { reference: req.reference, regime, requestType, channel });
  return req;
}

export type RequestAction =
  | { action: "verify"; method: string }
  | { action: "assign"; userId: string }
  | { action: "extend"; dueAt: string; reason: string }
  | { action: "submit_for_approval" }
  | { action: "approve" }
  | { action: "return_to_processing"; note: string }
  | { action: "complete"; outcome: "fulfilled" | "partially_fulfilled"; reason?: string }
  | { action: "reject"; reason: string };

/**
 * Moves a request through its workflow. Every step re-reads the request in
 * this tenant, checks the state machine and the four-eyes rule, and writes
 * conditionally on the status it read (a concurrent change wins cleanly).
 */
export async function advanceRequest(tenantId: string, actorId: string, requestId: string, step: RequestAction): Promise<PrivacyRequest> {
  const supabase = db();
  const { data: row } = await supabase.from("privacy_requests").select().eq("id", requestId).eq("tenant_id", tenantId).maybeSingle();
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such privacy request");
  const req = toRequest(row);
  const patch: Record<string, unknown> = { updated_at: now().toISOString() };
  let to: RequestStatus | null = null;
  const verified = !!req.identityVerifiedAt;

  switch (step.action) {
    case "verify": {
      const method = str(step.method, 200);
      if (!method) throw new ApiError(400, "VALIDATION_FAILED", "Record how the identity was verified");
      Object.assign(patch, { identity_verified_at: now().toISOString(), identity_verified_by: actorId, verification_method: method });
      to = req.status === "received" || req.status === "identity_verification" ? "in_progress" : null;
      break;
    }
    case "assign":
      patch.assigned_to = step.userId;
      break;
    case "extend": {
      const reason = str(step.reason, 2000);
      const dueAt = new Date(step.dueAt);
      if (!reason || reason.length < 10) throw new ApiError(400, "VALIDATION_FAILED", "Give the reason for the extension (it must be told to the requester)");
      const refusal = Number.isNaN(dueAt.getTime()) ? "Enter a valid date." : checkExtension(req.regime, new Date(req.receivedAt), new Date(req.dueAt), dueAt, now(), !!req.extendedDueAt);
      if (refusal) throw new ApiError(400, "EXTENSION_REFUSED", refusal);
      Object.assign(patch, { extended_due_at: dueAt.toISOString(), extension_reason: reason });
      break;
    }
    case "submit_for_approval":
      if (!requiresApproval(req.requestType)) throw new ApiError(400, "NOT_REQUIRED", "Only erasure needs a second approval");
      if (!verified) throw new ApiError(409, "IDENTITY_NOT_VERIFIED", "Verify the requester's identity first");
      to = "awaiting_approval";
      patch.processed_by = actorId;
      break;
    case "return_to_processing":
      if (req.status !== "awaiting_approval") throw new ApiError(409, "INVALID_STATE", "Only a request awaiting approval can be returned");
      to = "in_progress";
      patch.result = { ...req.result, returnedNote: str(step.note, 1000) };
      break;
    case "approve": {
      if (req.status !== "awaiting_approval") throw new ApiError(409, "INVALID_STATE", "This request is not awaiting approval");
      if (req.processedBy === actorId) {
        await audit(tenantId, actorId, "privacy.request_self_approval_refused", "privacy_request", requestId, {}, "failure");
        throw new ApiError(403, "FOUR_EYES_REQUIRED", "A different person must approve what you prepared");
      }
      // Nor can the person whose data it is approve its erasure (a conflict of interest, and Foundation's lifecycle refuses a self-removal).
      if (req.subjectUserId && req.subjectUserId === actorId) {
        await audit(tenantId, actorId, "privacy.request_self_approval_refused", "privacy_request", requestId, { reason: "subject" }, "failure");
        throw new ApiError(403, "FOUR_EYES_REQUIRED", "Someone other than the requester must approve the erasure of their own data");
      }
      // Execute first; only a completed erasure is recorded as completed (§17.5).
      const result = await eraseSubject(tenantId, actorId, { userId: req.subjectUserId, email: req.subjectEmail }, requestId);
      to = "completed";
      Object.assign(patch, { approved_by: actorId, outcome: "fulfilled", completed_at: now().toISOString(), result: { ...req.result, erasure: result }, subject_email: String(result.pseudonym), subject_name: null });
      break;
    }
    case "complete": {
      if (requiresApproval(req.requestType)) throw new ApiError(409, "APPROVAL_REQUIRED", "Erasure is completed by a second person's approval");
      if (requiresVerification(req.requestType) && !verified) throw new ApiError(409, "IDENTITY_NOT_VERIFIED", "Verify the requester's identity first");
      to = "completed";
      const extra: Record<string, unknown> = {};
      if (req.requestType === "withdraw_consent" && req.subjectUserId) {
        const { data: withdrawn } = await supabase
          .from("privacy_consent_records")
          .update({ status: "withdrawn", withdrawn_at: now().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("subject_user_id", req.subjectUserId)
          .eq("status", "granted")
          .select("id");
        extra.consentsWithdrawn = withdrawn?.length ?? 0;
      }
      Object.assign(patch, { outcome: step.outcome, outcome_reason: str(step.reason, 4000), processed_by: req.processedBy ?? actorId, completed_at: now().toISOString(), result: { ...req.result, ...extra } });
      break;
    }
    case "reject": {
      const reason = str(step.reason, 4000);
      if (!reason || reason.length < 10) throw new ApiError(400, "VALIDATION_FAILED", "Give the reason for refusing; the requester must be told it and how to complain");
      to = "rejected";
      Object.assign(patch, { outcome: "refused", outcome_reason: reason, processed_by: actorId, completed_at: now().toISOString() });
      break;
    }
  }

  if (to && to !== req.status && !canTransition(req.status, to)) throw new ApiError(409, "INVALID_STATE", `A ${req.status.replace("_", " ")} request cannot move to ${to.replace("_", " ")}`);
  if (to) patch.status = to;
  const { data: updated, error } = await supabase.from("privacy_requests").update(patch).eq("id", requestId).eq("tenant_id", tenantId).eq("status", req.status).select().maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!updated) throw new ApiError(409, "CHANGED", "This request changed while you were working on it. Reload and try again.");
  await audit(tenantId, actorId, `privacy.request_${step.action}`, "privacy_request", requestId, { reference: req.reference, from: req.status, to: to ?? req.status });
  return toRequest(updated);
}

/** The subject withdraws their own open request. */
export async function withdrawMyRequest(tenantId: string, userId: string, requestId: string): Promise<void> {
  const { data, error } = await db()
    .from("privacy_requests")
    .update({ status: "withdrawn", completed_at: now().toISOString(), updated_at: now().toISOString() })
    .eq("id", requestId)
    .eq("tenant_id", tenantId)
    .eq("subject_user_id", userId)
    .in("status", ["received", "identity_verification", "in_progress"])
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(409, "INVALID_STATE", "Only your own open request can be withdrawn");
  await audit(tenantId, userId, "privacy.request_withdrawn", "privacy_request", requestId);
}

/** The data export for an access or portability request (staff), audited. */
export async function exportForRequest(tenantId: string, actorId: string, requestId: string): Promise<Record<string, unknown>> {
  const { data: row } = await db().from("privacy_requests").select().eq("id", requestId).eq("tenant_id", tenantId).maybeSingle();
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such privacy request");
  const req = toRequest(row);
  if (!["access", "portability"].includes(req.requestType)) throw new ApiError(400, "NOT_APPLICABLE", "Exports are for access and portability requests");
  if (!req.identityVerifiedAt) throw new ApiError(409, "IDENTITY_NOT_VERIFIED", "Verify the requester's identity before releasing their data");
  const out = await buildSubjectExport(tenantId, { userId: req.subjectUserId, email: req.subjectEmail });
  await audit(tenantId, actorId, "privacy.subject_export_generated", "privacy_request", requestId, { reference: req.reference });
  return out;
}

/** A member downloads their own data at any time (no request needed; the session is the verification). */
export async function exportMyData(tenantId: string, userId: string): Promise<Record<string, unknown>> {
  const email = await memberEmail(tenantId, userId);
  const out = await buildSubjectExport(tenantId, { userId, email });
  await audit(tenantId, userId, "privacy.self_export_generated", "user", userId);
  return out;
}

// ================================================================ retention and legal holds

const toPolicy = (r: any): RetentionPolicy => ({ id: r.id, dataCategory: r.data_category, retentionDays: r.retention_days, enabled: r.enabled, lastRunAt: r.last_run_at, lastRunAffected: r.last_run_affected === null ? null : Number(r.last_run_affected) });
const toHold = (r: any): LegalHold => ({ id: r.id, name: r.name, reason: r.reason, dataCategories: r.data_categories, placedBy: r.placed_by, placedAt: r.placed_at, releasedAt: r.released_at });

export async function listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_retention_policies").select().eq("tenant_id", tenantId);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toPolicy);
}

export async function saveRetentionPolicy(tenantId: string, actorId: string, category: string, days: number, enabled: boolean): Promise<void> {
  if (!RETENTION_CATEGORIES.some((c) => c.key === category)) throw new ApiError(400, "VALIDATION_FAILED", "Unknown data category");
  const min = minRetentionDays(category as RetentionCategory);
  if (!Number.isInteger(days) || days < min || days > 36500) throw new ApiError(400, "VALIDATION_FAILED", `Keep this data at least ${min} days`);
  const { error } = await db()
    .from("privacy_retention_policies")
    .upsert({ tenant_id: tenantId, data_category: category, retention_days: days, enabled, updated_by: actorId, updated_at: now().toISOString() }, { onConflict: "tenant_id,data_category" });
  if (error) throw new ApiError(500, "SAVE_FAILED", error.message);
  await audit(tenantId, actorId, "privacy.retention_policy_saved", "retention_policy", category, { days, enabled });
}

export async function listLegalHolds(tenantId: string): Promise<LegalHold[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_legal_holds").select().eq("tenant_id", tenantId).order("placed_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toHold);
}

export async function placeLegalHold(tenantId: string, actorId: string, raw: { name: unknown; reason: unknown; categories: unknown }): Promise<void> {
  const name = str(raw.name, 200);
  const reason = str(raw.reason, 2000);
  const categories = list(raw.categories).filter((c) => RETENTION_CATEGORIES.some((k) => k.key === c));
  if (!name || !reason || reason.length < 10 || !categories.length) throw new ApiError(400, "VALIDATION_FAILED", "Name the hold, give a reason (10+ characters) and choose what it covers");
  const { data, error } = await db().from("privacy_legal_holds").insert({ tenant_id: tenantId, name, reason, data_categories: categories, placed_by: actorId }).select("id").single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to place the hold");
  await audit(tenantId, actorId, "privacy.legal_hold_placed", "legal_hold", data.id, { categories });
}

export async function releaseLegalHold(tenantId: string, actorId: string, holdId: string): Promise<void> {
  const { data, error } = await db().from("privacy_legal_holds").update({ released_at: now().toISOString(), released_by: actorId }).eq("id", holdId).eq("tenant_id", tenantId).is("released_at", null).select("id").maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(404, "NOT_FOUND", "No active hold with that id");
  await audit(tenantId, actorId, "privacy.legal_hold_released", "legal_hold", holdId);
}

async function heldCategories(tenantId: string): Promise<Set<string>> {
  const { data } = await db().from("privacy_legal_holds").select("data_categories").eq("tenant_id", tenantId).is("released_at", null);
  return new Set((data ?? []).flatMap((h) => h.data_categories as string[]));
}

/** Applies one tenant's enabled retention policies. Returns rows affected per category. */
export async function runRetentionForTenant(tenantId: string): Promise<Record<string, number | string>> {
  const supabase = db();
  const [{ data: policies }, holds] = await Promise.all([supabase.from("privacy_retention_policies").select().eq("tenant_id", tenantId).eq("enabled", true), heldCategories(tenantId)]);
  const results: Record<string, number | string> = {};
  for (const p of policies ?? []) {
    const category = p.data_category as RetentionCategory;
    if (holds.has(category)) {
      results[category] = "held";
      continue;
    }
    const cutoff = retentionCutoff(now(), Math.max(p.retention_days, minRetentionDays(category))).toISOString();
    let affected = 0;
    try {
      switch (category) {
        case "audit_logs": {
          const { data, error } = await supabase.rpc("purge_audit_logs", { p_tenant: tenantId, p_before: cutoff });
          if (error) throw new Error(error.message);
          affected = Number(data ?? 0);
          break;
        }
        case "runtime_events": {
          const { count, error } = await supabase.from("runtime_events").delete({ count: "exact" }).eq("tenant_id", tenantId).lt("event_time", cutoff);
          if (error) throw new Error(error.message);
          affected = count ?? 0;
          break;
        }
        case "notifications": {
          const { count, error } = await supabase.from("notifications").delete({ count: "exact" }).eq("tenant_id", tenantId).lt("created_at", cutoff);
          if (error) throw new Error(error.message);
          affected = count ?? 0;
          break;
        }
        case "closed_privacy_requests": {
          const { data: rows } = await supabase.from("privacy_requests").select("id, subject_email").eq("tenant_id", tenantId).in("status", ["completed", "rejected", "withdrawn"]).lt("completed_at", cutoff).not("subject_email", "like", "erased-%").limit(1000);
          for (const r of rows ?? []) {
            await supabase.from("privacy_requests").update({ subject_email: pseudonymLabel(subjectHash(tenantId, r.subject_email)), subject_name: null, description: null }).eq("id", r.id).eq("tenant_id", tenantId);
            affected++;
          }
          break;
        }
        case "withdrawn_consents": {
          const { data: rows } = await supabase.from("privacy_consent_records").select("id, subject_identifier").eq("tenant_id", tenantId).eq("status", "withdrawn").lt("withdrawn_at", cutoff).not("subject_identifier", "like", "erased-%").limit(1000);
          for (const r of rows ?? []) {
            await supabase.from("privacy_consent_records").update({ subject_identifier: pseudonymLabel(subjectHash(tenantId, r.subject_identifier)), subject_user_id: null, evidence: {} }).eq("id", r.id).eq("tenant_id", tenantId);
            affected++;
          }
          break;
        }
        case "removed_members": {
          const { data: rows } = await supabase.from("tenant_memberships").select("user_id").eq("tenant_id", tenantId).eq("status", "removed").lt("status_changed_at", cutoff).limit(1000);
          for (const r of rows ?? []) affected += await pseudonymiseRemovedMember(tenantId, r.user_id);
          break;
        }
      }
      results[category] = affected;
      await supabase.from("privacy_retention_policies").update({ last_run_at: now().toISOString(), last_run_affected: affected }).eq("id", p.id).eq("tenant_id", tenantId);
    } catch (err) {
      results[category] = `failed: ${err instanceof Error ? err.message : "error"}`;
    }
  }
  if (Object.keys(results).length) await audit(tenantId, null, "privacy.retention_run", "retention_policy", tenantId, { results });
  return results;
}

// ================================================================ breach register

function toBreach(r: any): BreachIncident {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    description: r.description,
    severity: r.severity,
    riskToIndividuals: r.risk_to_individuals,
    regimes: r.regimes,
    dataCategories: r.data_categories ?? [],
    subjectsAffected: r.subjects_affected,
    occurredAt: r.occurred_at,
    detectedAt: r.detected_at,
    containedAt: r.contained_at,
    authorityNotifiedAt: r.authority_notified_at,
    authorityReference: r.authority_reference,
    dpbNotifiedAt: r.dpb_notified_at,
    dpbReportAt: r.dpb_report_at,
    subjectsNotifiedAt: r.subjects_notified_at,
    delayReason: r.delay_reason,
    rootCause: r.root_cause,
    remediation: r.remediation,
    status: r.status,
    closedAt: r.closed_at,
    createdAt: r.created_at,
  };
}

export function breachFacts(b: BreachIncident) {
  const d = (v: string | null) => (v ? new Date(v) : null);
  return {
    regimes: b.regimes,
    riskToIndividuals: b.riskToIndividuals,
    detectedAt: new Date(b.detectedAt),
    authorityNotifiedAt: d(b.authorityNotifiedAt),
    dpbNotifiedAt: d(b.dpbNotifiedAt),
    dpbReportAt: d(b.dpbReportAt),
    subjectsNotifiedAt: d(b.subjectsNotifiedAt),
    status: b.status,
  };
}

export async function listBreaches(tenantId: string): Promise<BreachIncident[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_breach_incidents").select().eq("tenant_id", tenantId).order("detected_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toBreach);
}

export async function getBreach(tenantId: string, id: string): Promise<BreachIncident | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("privacy_breach_incidents").select().eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data ? toBreach(data) : null;
}

const isoOrNull = (v: unknown): string | null => {
  const s = str(v, 40);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "VALIDATION_FAILED", `Invalid date: ${s}`);
  if (d > new Date(Date.now() + 60_000)) throw new ApiError(400, "VALIDATION_FAILED", "Dates cannot be in the future");
  return d.toISOString();
};

export async function createBreach(tenantId: string, actorId: string, raw: Record<string, unknown>): Promise<BreachIncident> {
  const title = str(raw.title, 200);
  const description = str(raw.description, 8000);
  const severity = str(raw.severity, 10);
  const risk = str(raw.riskToIndividuals, 10);
  const regimes = list(raw.regimes).filter((r) => (REGIMES as string[]).includes(r));
  const detectedAt = isoOrNull(raw.detectedAt) ?? now().toISOString();
  if (!title || title.length < 3 || !description || description.length < 10) throw new ApiError(400, "VALIDATION_FAILED", "Give a title and a description of what happened");
  if (!["low", "medium", "high", "critical"].includes(severity ?? "")) throw new ApiError(400, "VALIDATION_FAILED", "Choose the severity");
  if (!["unlikely", "risk", "high_risk"].includes(risk ?? "")) throw new ApiError(400, "VALIDATION_FAILED", "Assess the risk to individuals");
  if (!regimes.length) throw new ApiError(400, "VALIDATION_FAILED", "Choose the laws that apply to the affected people");
  const subjects = str(raw.subjectsAffected, 10);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db()
      .from("privacy_breach_incidents")
      .insert({
        tenant_id: tenantId,
        reference: requestReference("BR", now()),
        title,
        description,
        severity,
        risk_to_individuals: risk,
        regimes,
        data_categories: list(raw.dataCategories),
        subjects_affected: subjects ? Math.max(0, Math.floor(Number(subjects)) || 0) : null,
        occurred_at: isoOrNull(raw.occurredAt),
        detected_at: detectedAt,
        created_by: actorId,
      })
      .select()
      .single();
    if (!error && data) {
      const breach = toBreach(data);
      await audit(tenantId, actorId, "privacy.breach_recorded", "breach_incident", breach.id, { reference: breach.reference, severity, risk, regimes });
      const holders = await listPermissionHolders(tenantId, "privacy.incidents.manage");
      await Promise.all(
        holders.map((userId) => notify({ tenantId, userId, type: "privacy_deadline", title: `Breach ${breach.reference} recorded`, body: "Statutory notification clocks have started (72 hours under GDPR and DPDP). Open the breach register.", referenceType: "breach_incident", referenceId: breach.id })),
      );
      return breach;
    }
    if (error?.code !== "23505") throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to record the breach");
  }
  throw new ApiError(500, "CREATE_FAILED", "Could not allocate a breach reference");
}

export async function updateBreach(tenantId: string, actorId: string, breachId: string, raw: Record<string, unknown>): Promise<BreachIncident> {
  const supabase = db();
  const { data: row } = await supabase.from("privacy_breach_incidents").select().eq("id", breachId).eq("tenant_id", tenantId).maybeSingle();
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such breach");
  if (row.status === "closed") throw new ApiError(409, "CLOSED", "A closed breach record cannot be changed");
  const patch: Record<string, unknown> = { updated_at: now().toISOString() };
  const timestamps = ["containedAt", "authorityNotifiedAt", "dpbNotifiedAt", "dpbReportAt", "subjectsNotifiedAt"] as const;
  const columns: Record<(typeof timestamps)[number], string> = { containedAt: "contained_at", authorityNotifiedAt: "authority_notified_at", dpbNotifiedAt: "dpb_notified_at", dpbReportAt: "dpb_report_at", subjectsNotifiedAt: "subjects_notified_at" };
  for (const k of timestamps) {
    // A recorded notification time is evidence: it can be set, not cleared or rewritten.
    if (raw[k] !== undefined && raw[k] !== "" && !row[columns[k]]) patch[columns[k]] = isoOrNull(raw[k]);
  }
  for (const [k, col, max] of [["authorityReference", "authority_reference", 200], ["delayReason", "delay_reason", 4000], ["rootCause", "root_cause", 8000], ["remediation", "remediation", 8000]] as const) {
    if (raw[k] !== undefined) patch[col] = str(raw[k], max);
  }
  if (raw.subjectsAffected !== undefined && raw.subjectsAffected !== "") patch.subjects_affected = Math.max(0, Math.floor(Number(raw.subjectsAffected)) || 0);
  if (raw.riskToIndividuals && ["unlikely", "risk", "high_risk"].includes(String(raw.riskToIndividuals))) patch.risk_to_individuals = raw.riskToIndividuals;
  if (patch.contained_at && row.status === "open") patch.status = "contained";
  const { data, error } = await supabase.from("privacy_breach_incidents").update(patch).eq("id", breachId).eq("tenant_id", tenantId).neq("status", "closed").select().maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(409, "CHANGED", "The breach changed; reload and try again");
  await audit(tenantId, actorId, "privacy.breach_updated", "breach_incident", breachId, { fields: Object.keys(patch).filter((k) => k !== "updated_at") });
  return toBreach(data);
}

export async function closeBreach(tenantId: string, actorId: string, breachId: string): Promise<BreachIncident> {
  const supabase = db();
  const { data: row } = await supabase.from("privacy_breach_incidents").select().eq("id", breachId).eq("tenant_id", tenantId).maybeSingle();
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such breach");
  const breach = toBreach(row);
  if (breach.status === "closed") return breach;
  const refusal = closeBreachRefusal(breachFacts(breach), breach.delayReason, now());
  if (refusal) throw new ApiError(409, "NOTIFICATIONS_OUTSTANDING", refusal);
  if (!breach.rootCause || !breach.remediation) throw new ApiError(409, "INCOMPLETE", "Record the root cause and the remediation before closing");
  const { data, error } = await supabase.from("privacy_breach_incidents").update({ status: "closed", closed_at: now().toISOString(), closed_by: actorId, updated_at: now().toISOString() }).eq("id", breachId).eq("tenant_id", tenantId).neq("status", "closed").select().maybeSingle();
  if (error || !data) throw new ApiError(500, "UPDATE_FAILED", error?.message ?? "Failed to close");
  await audit(tenantId, actorId, "privacy.breach_closed", "breach_incident", breachId, { reference: breach.reference });
  return toBreach(data);
}

// ================================================================ deadline sweep (cron)

async function notifyPrivacyStaff(tenantId: string, title: string, body: string, referenceId: string, key = "privacy.requests.process") {
  const holders = await listPermissionHolders(tenantId, key);
  await Promise.all(holders.map((userId) => notify({ tenantId, userId, type: "privacy_deadline", title, body, referenceType: "privacy_request", referenceId })));
}

/** Daily: reminds privacy staff of requests due within 7 days or overdue, and of outstanding breach notices (deduplicated per day). */
export async function sweepPrivacyDeadlines(tenantId: string): Promise<{ requestReminders: number; breachReminders: number }> {
  const supabase = db();
  const at = now();
  const soon = new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: reqs }, { data: breaches }] = await Promise.all([
    supabase.from("privacy_requests").select().eq("tenant_id", tenantId).not("status", "in", "(completed,rejected,withdrawn)").lte("due_at", soon).limit(500),
    supabase.from("privacy_breach_incidents").select().eq("tenant_id", tenantId).neq("status", "closed").limit(200),
  ]);
  let requestReminders = 0;
  for (const r of (reqs ?? []).map(toRequest)) {
    const due = new Date(r.extendedDueAt ?? r.dueAt);
    const state = deadlineState(r.status, due, at);
    if (state !== "due_soon" && state !== "overdue") continue;
    if (await wasRecentlyNotified(tenantId, "privacy_deadline", r.id, 1)) continue;
    await notifyPrivacyStaff(tenantId, state === "overdue" ? `Privacy request ${r.reference} is overdue` : `Privacy request ${r.reference} is due soon`, `Respond by ${due.toISOString().slice(0, 10)} (${r.regime.toUpperCase()}).`, r.id);
    requestReminders++;
  }
  let breachReminders = 0;
  for (const b of (breaches ?? []).map(toBreach)) {
    const open = breachObligations(breachFacts(b), at).filter((o) => o.state === "pending" || o.state === "overdue");
    if (!open.length || (await wasRecentlyNotified(tenantId, "privacy_deadline", b.id, 1))) continue;
    await notifyPrivacyStaff(tenantId, `Breach ${b.reference}: notifications outstanding`, open.map((o) => `${o.label}${o.dueAt ? ` (due ${o.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}`).join("; "), b.id, "privacy.incidents.manage");
    breachReminders++;
  }
  return { requestReminders, breachReminders };
}

/** Every active tenant, one at a time, each step filtered by that tenant (no cross-tenant query does any write). */
export async function runPrivacyJobs(): Promise<{ tenants: number; retention: Record<string, Record<string, number | string>>; reminders: Record<string, unknown> }> {
  const { data: tenants } = await db().from("tenants").select("id").eq("status", "active").limit(5000);
  const retention: Record<string, Record<string, number | string>> = {};
  const reminders: Record<string, unknown> = {};
  for (const t of tenants ?? []) {
    try {
      retention[t.id] = await runRetentionForTenant(t.id);
      reminders[t.id] = await sweepPrivacyDeadlines(t.id);
    } catch (err) {
      reminders[t.id] = { failed: err instanceof Error ? err.message : "error" };
    }
  }
  return { tenants: tenants?.length ?? 0, retention, reminders };
}
