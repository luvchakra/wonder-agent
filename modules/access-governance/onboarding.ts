import "server-only";

import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ApplicationOnboardingStatus, ApplicationOnboardingTemplate } from "@/lib/shared/types/access-governance";
import { getIntegration, getNormalizedObjects, listSyncJobs } from "@/modules/integrations/service";
import { listIdentitiesForCorrelation } from "@/modules/agent-identity/service";
import { getApplicationDetail, updateApplication } from "./catalog";
import { declareTemplateTypes, getOnboardingTemplate, listOnboardingTemplates, templateForStart } from "./onboardingTemplates";
import { connectionTypeKeyOf, missingAnswers, templateFits, validateAnswers, type Answers } from "./onboardingTemplateRules";
import { belongsToApplication } from "./connectorAccessRules";
import {
  EMPTY_CONFIG,
  blockReason,
  configHash,
  evaluateChecklist,
  simulateOnboarding as runSimulation,
  validateOnboardingConfig,
  type ChecklistItem,
  type OnboardingConfig,
  type OnboardingState,
  type OnboardingStatus,
  type SimulationResult,
} from "./onboardingRules";

/**
 * ACCESS-P0-16 — application onboarding (spec §8): configure, validate,
 * simulate, approve (four-eyes), promote. Reads run as the calling user
 * (RLS). Members have no write policy on onboarding records, so the service
 * writes them with the service role, always filtered by the tenant it
 * resolved server-side, after checking the stage. Every stage change is
 * a conditional update on the state it expects, so two people acting at
 * once cannot both succeed; each is audited.
 *
 * Simulation only reads (integration objects, identities); its results are
 * written to the onboarding record and nowhere else.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValidationResults = { items: ChecklistItem[]; blockingFailures: string[]; automationReady: boolean; at: string };

export type ApplicationOnboarding = {
  id: string;
  applicationId: string;
  mode: "quick_start" | "assisted" | "advanced";
  status: OnboardingStatus;
  config: OnboardingConfig;
  configVersion: number;
  configHash: string;
  validation: (ValidationResults & { current: boolean }) | null;
  simulation: (SimulationResult & { at: string; current: boolean }) | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedHash: string | null;
  decisionNote: string | null;
  promotedAt: string | null;
  promotedHash: string | null;
  /** ACCESS-P0-34: the template it started from, and the questionnaire's answers. */
  templateId: string | null;
  answers: Answers;
  updatedAt: string;
};

type Row = Record<string, unknown>;

function toOnboarding(r: Row): ApplicationOnboarding {
  const hash = r.config_hash as string;
  const validation = r.validation_results as ValidationResults | null;
  const simulation = r.simulation_results as (SimulationResult & { at: string }) | null;
  return {
    id: r.id as string,
    applicationId: r.application_id as string,
    mode: r.mode as ApplicationOnboarding["mode"],
    status: r.status as OnboardingStatus,
    config: { ...EMPTY_CONFIG, ...(r.config as Partial<OnboardingConfig>), operations: { ...EMPTY_CONFIG.operations, ...((r.config as Partial<OnboardingConfig>)?.operations ?? {}) } },
    configVersion: Number(r.config_version),
    configHash: hash,
    validation: validation ? { ...validation, current: r.validated_hash === hash } : null,
    simulation: simulation ? { ...simulation, current: r.simulated_hash === hash } : null,
    submittedBy: (r.submitted_by as string | null) ?? null,
    submittedAt: (r.submitted_at as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    approvedHash: (r.approved_hash as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    promotedAt: (r.promoted_at as string | null) ?? null,
    promotedHash: (r.promoted_hash as string | null) ?? null,
    templateId: (r.template_id as string | null) ?? null,
    answers: (r.answers as Answers | null) ?? {},
    updatedAt: r.updated_at as string,
  };
}

function stateOf(o: ApplicationOnboarding, r?: Row): OnboardingState {
  return {
    status: o.status,
    configHash: o.configHash,
    validatedHash: (r?.validated_hash as string | null) ?? (o.validation?.current ? o.configHash : null),
    validationPassed: Boolean(o.validation && o.validation.blockingFailures.length === 0),
    simulatedHash: (r?.simulated_hash as string | null) ?? (o.simulation?.current ? o.configHash : null),
    simulationPassed: Boolean(o.simulation?.passed),
    submittedBy: o.submittedBy,
    approvedHash: o.approvedHash,
  };
}

async function loadRow(tenantId: string, applicationId: string): Promise<Row | null> {
  if (!UUID_RE.test(applicationId)) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("application_onboardings").select().eq("tenant_id", tenantId).eq("application_id", applicationId).maybeSingle();
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return data;
}

export async function getOnboarding(tenantId: string, applicationId: string): Promise<ApplicationOnboarding | null> {
  const row = await loadRow(tenantId, applicationId);
  return row ? toOnboarding(row) : null;
}

/** The catalog status an onboarding stage implies, for an application not yet live. */
const CATALOG_STATUS: Partial<Record<OnboardingStatus, ApplicationOnboardingStatus>> = {
  CONFIGURING: "CONFIGURING",
  VALIDATING: "VALIDATING",
  FAILED: "SIMULATION_FAILED",
  WAITING_FOR_APPROVAL: "READY_FOR_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "CONFIGURING",
};
const LIVE = new Set<ApplicationOnboardingStatus>(["ACTIVE", "SUSPENDED", "RETIRED"]);

/** Keeps the catalog's status in step with onboarding, never demoting a live application. */
async function syncCatalogStatus(tenantId: string, applicationId: string, status: OnboardingStatus, connected: boolean) {
  const app = await getApplicationDetail(tenantId, applicationId);
  if (!app || LIVE.has(app.onboardingStatus)) return;
  let next = CATALOG_STATUS[status];
  if (next === "CONFIGURING" && connected) next = "CONNECTED";
  if (!next || next === app.onboardingStatus) return;
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("applications")
    .update({ onboarding_status: next, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", applicationId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
}

function audit(tenantId: string, actorId: string, applicationId: string, action: string, metadata: Record<string, unknown>, typedText?: Record<string, string | null>) {
  return writeAudit({ tenantId, actorId, actorType: "user", action: `application.onboarding_${action}`, objectType: "application", objectId: applicationId, outcome: "success", metadata, typedText });
}

/** A conditional update: applies only if the record is still in `expect`; otherwise 409. */
async function transition(tenantId: string, applicationId: string, expect: { status?: OnboardingStatus[]; configHash?: string }, patch: Row): Promise<ApplicationOnboarding> {
  // Service role (members cannot write onboarding rows): scoped to the tenant explicitly.
  let query = supabaseServiceRole()
    .from("application_onboardings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId);
  if (expect.status) query = query.in("status", expect.status);
  if (expect.configHash) query = query.eq("config_hash", expect.configHash);
  const { data, error } = await query.select().maybeSingle();
  if (error?.code === "23514") throw new ApiError(409, "FOUR_EYES", "Someone other than the submitter must approve");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data) throw new ApiError(409, "CONFLICT", "The onboarding changed meanwhile; reload and try again");
  return toOnboarding(data);
}

async function requireOnboarding(tenantId: string, applicationId: string): Promise<{ o: ApplicationOnboarding; row: Row }> {
  const row = await loadRow(tenantId, applicationId);
  if (!row) throw new ApiError(404, "NOT_FOUND", "This application has no onboarding yet");
  return { o: toOnboarding(row), row };
}

/**
 * Starts onboarding, optionally from a template (ACCESS-P0-34): its
 * configuration defaults fill the draft, its owners fill the application's
 * empty owner fields, and its entitlement types are declared on the
 * application. A template for a connection type fits only an application
 * connected through that type. Re-onboarding keeps the earlier
 * configuration and does not apply a template.
 */
export async function startOnboarding(tenantId: string, actorId: string, applicationId: string, mode: unknown, templateId?: unknown): Promise<ApplicationOnboarding> {
  const app = await getApplicationDetail(tenantId, applicationId);
  if (!app) throw new ApiError(404, "NOT_FOUND", "No such application");
  if (app.onboardingStatus === "RETIRED") throw new ApiError(409, "RETIRED", "A retired application is not onboarded");
  const m = mode === "quick_start" || mode === "advanced" ? mode : "assisted";
  if (templateId !== undefined && templateId !== null && templateId !== "" && typeof templateId !== "string") throw new ApiError(400, "VALIDATION_FAILED", "templateId: a template");
  const existing = await loadRow(tenantId, applicationId);
  if (existing) {
    const o = toOnboarding(existing);
    if (o.status !== "PROMOTED" && o.status !== "ARCHIVED") return o;
    // Re-onboarding keeps the configuration as the starting point.
    const again = await transition(tenantId, applicationId, { status: [o.status] }, { status: "CONFIGURING", mode: m, submitted_by: null, submitted_at: null, decision_note: null });
    await audit(tenantId, actorId, applicationId, "started", { mode: m, reonboarding: true });
    return again;
  }
  let config: OnboardingConfig = { ...EMPTY_CONFIG, integrationId: app.sourceIntegrationId };
  const chosen = templateId ? await templateForStart(tenantId, templateId as string) : null;
  if (chosen) {
    const connection = app.sourceIntegrationId ? await getIntegration(tenantId, app.sourceIntegrationId) : null;
    if (!templateFits(chosen.template.connectionTypeKey, connectionTypeKeyOf(connection))) {
      throw new ApiError(409, "TEMPLATE_DOES_NOT_FIT", `templateId: "${chosen.template.name}" is for applications connected through ${chosen.template.connectionTypeKey}`);
    }
    config = validateOnboardingConfig(chosen.stored.defaults.config, config);
  }
  // Service role: the application was just read under RLS in this tenant.
  const { data, error } = await supabaseServiceRole()
    .from("application_onboardings")
    .insert({ tenant_id: tenantId, application_id: applicationId, mode: m, status: "CONFIGURING", config, config_hash: configHash(config), created_by: actorId, template_id: chosen?.template.id ?? null })
    .select()
    .single();
  if (error?.code === "23505") return (await getOnboarding(tenantId, applicationId))!;
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Could not start onboarding");
  let declaredTypes = 0;
  if (chosen) {
    // Owners the application has stay; only empty ones take the template's.
    const owners: Record<string, string> = {};
    if (!app.businessOwnerIdentityId && chosen.template.defaults.businessOwnerIdentityId) owners.businessOwnerIdentityId = chosen.template.defaults.businessOwnerIdentityId;
    if (!app.technicalOwnerIdentityId && chosen.template.defaults.technicalOwnerIdentityId) owners.technicalOwnerIdentityId = chosen.template.defaults.technicalOwnerIdentityId;
    if (Object.keys(owners).length) await updateApplication(tenantId, actorId, applicationId, owners);
    declaredTypes = await declareTemplateTypes(tenantId, applicationId, actorId, chosen.stored.entitlement_types);
  }
  await syncCatalogStatus(tenantId, applicationId, "CONFIGURING", Boolean(config.integrationId));
  await audit(tenantId, actorId, applicationId, "started", { mode: m, templateId: chosen?.template.id ?? null, declaredTypes });
  return toOnboarding(data);
}

/** Changes the configuration. Any change invalidates validation, simulation and approval (spec §8.6). */
export async function configureOnboarding(tenantId: string, actorId: string, applicationId: string, input: Record<string, unknown>): Promise<ApplicationOnboarding> {
  const { o } = await requireOnboarding(tenantId, applicationId);
  const reason = blockReason("configure", stateOf(o), actorId);
  if (reason) throw new ApiError(409, "INVALID_STAGE", reason);
  const next = validateOnboardingConfig(input, o.config);
  if (next.integrationId && next.integrationId !== o.config.integrationId) {
    const integration = await getIntegration(tenantId, next.integrationId);
    if (!integration) throw new ApiError(404, "NOT_FOUND", "integrationId: that integration is not in this organization");
  }
  const hash = configHash(next);
  if (hash === o.configHash) return o;
  // A changed configuration needs validating, simulating and approving again.
  const updated = await transition(
    tenantId,
    applicationId,
    { configHash: o.configHash },
    {
      config: next,
      config_hash: hash,
      config_version: o.configVersion + 1,
      status: "CONFIGURING",
      submitted_by: null,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      approved_hash: null,
      approved_config: null,
    },
  );
  await syncCatalogStatus(tenantId, applicationId, "CONFIGURING", Boolean(next.integrationId));
  await audit(tenantId, actorId, applicationId, "configured", { configVersion: updated.configVersion, invalidated: Boolean(o.validation || o.simulation || o.approvedHash) });
  return updated;
}

/**
 * ACCESS-P0-34: records the questionnaire's answers. A change after
 * validation is a change to what is approved, so the onboarding goes back
 * to configuring and is validated, simulated and approved again.
 */
export async function answerOnboarding(tenantId: string, actorId: string, applicationId: string, input: unknown): Promise<ApplicationOnboarding> {
  const { o } = await requireOnboarding(tenantId, applicationId);
  const reason = blockReason("configure", stateOf(o), actorId);
  if (reason) throw new ApiError(409, "INVALID_STAGE", reason);
  if (!o.templateId) throw new ApiError(409, "NO_QUESTIONNAIRE", "This onboarding did not start from a template with questions");
  const template = await getOnboardingTemplate(tenantId, o.templateId);
  if (!template) throw new ApiError(404, "NOT_FOUND", "The template is no longer in this organization");
  const checked = validateAnswers(template.questions, input, o.answers);
  if ("error" in checked) throw new ApiError(400, "VALIDATION_FAILED", checked.error);
  const { answers } = checked;
  if (JSON.stringify(answers) === JSON.stringify(o.answers)) return o;
  const updated = await transition(
    tenantId,
    applicationId,
    { configHash: o.configHash },
    {
      answers,
      status: "CONFIGURING",
      validated_hash: null,
      simulated_hash: null,
      submitted_by: null,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      approved_hash: null,
      approved_config: null,
    },
  );
  await syncCatalogStatus(tenantId, applicationId, "CONFIGURING", Boolean(o.config.integrationId));
  // The answers stay on the onboarding record; the audit names the questions answered.
  await audit(tenantId, actorId, applicationId, "answered", { templateId: o.templateId, answered: Object.keys(answers), missing: missingAnswers(template.questions, answers).length });
  return updated;
}

/** The active templates that fit an application's connection type (ACCESS-P0-34): typed ones first, then those for any application. */
export async function onboardingTemplatesFor(tenantId: string, applicationId: string): Promise<ApplicationOnboardingTemplate[]> {
  const app = await getApplicationDetail(tenantId, applicationId);
  if (!app) return [];
  const [templates, connection] = await Promise.all([listOnboardingTemplates(tenantId), app.sourceIntegrationId ? getIntegration(tenantId, app.sourceIntegrationId) : Promise.resolve(null)]);
  const type = connectionTypeKeyOf(connection);
  return templates.filter((t) => templateFits(t.connectionTypeKey, type)).sort((a, b) => Number(b.connectionTypeKey !== null) - Number(a.connectionTypeKey !== null));
}

/** The template's required questions still unanswered; null without a questionnaire. */
async function questionnaireState(tenantId: string, o: ApplicationOnboarding): Promise<{ missing: string[] } | null> {
  if (!o.templateId) return null;
  const template = await getOnboardingTemplate(tenantId, o.templateId);
  if (!template || !template.questions.length) return null;
  return { missing: missingAnswers(template.questions, o.answers) };
}

async function checklistContext(tenantId: string, applicationId: string, config: OnboardingConfig) {
  const app = await getApplicationDetail(tenantId, applicationId);
  if (!app) throw new ApiError(404, "NOT_FOUND", "No such application");
  let integration: { capabilities: Record<string, boolean | undefined>; lastSyncStatus: string | null } | null = null;
  if (config.integrationId) {
    const [found, jobs] = await Promise.all([getIntegration(tenantId, config.integrationId), listSyncJobs(tenantId, config.integrationId)]);
    if (!found) throw new ApiError(404, "NOT_FOUND", "The configured integration is no longer in this organization");
    const lastCompleted = jobs.find((j) => j.status !== "queued" && j.status !== "running");
    integration = { capabilities: found.capabilities as Record<string, boolean | undefined>, lastSyncStatus: lastCompleted?.status ?? null };
  }
  return { app, integration };
}

/**
 * Entitlements the application has, or, when they come from the connector,
 * the ones its last sync staged for it: those are reconciled into WonderID
 * only after promotion (ACCESS-P0-27), so validation counts what was found.
 */
async function discoveredEntitlementCount(tenantId: string, config: OnboardingConfig, app: { id: string; name: string; entitlementCount: number }): Promise<number> {
  if (config.entitlementSource !== "connector" || !config.integrationId) return app.entitlementCount;
  const staged = await getNormalizedObjects(tenantId, config.integrationId, "entitlement");
  return Math.max(app.entitlementCount, staged.filter((o) => belongsToApplication(o.normalized ?? {}, app)).length);
}

/** Runs the §8.5 checklist on the current configuration. Reads only. */
export async function validateOnboarding(tenantId: string, actorId: string, applicationId: string): Promise<ApplicationOnboarding> {
  const { o } = await requireOnboarding(tenantId, applicationId);
  const reason = blockReason("validate", stateOf(o), actorId);
  if (reason) throw new ApiError(409, "INVALID_STAGE", reason);
  const [{ app, integration }, questionnaire] = await Promise.all([checklistContext(tenantId, applicationId, o.config), questionnaireState(tenantId, o)]);
  const result = evaluateChecklist({
    questionnaire,
    config: o.config,
    app: { businessOwnerIdentityId: app.businessOwnerIdentityId, technicalOwnerIdentityId: app.technicalOwnerIdentityId, riskLevel: app.riskLevel, dataClassification: app.dataClassification },
    integration,
    entitlementCount: await discoveredEntitlementCount(tenantId, o.config, app),
  });
  const passed = result.blockingFailures.length === 0;
  const status: OnboardingStatus = passed ? "VALIDATING" : "FAILED";
  const updated = await transition(
    tenantId,
    applicationId,
    { configHash: o.configHash },
    { validation_results: { ...result, at: new Date().toISOString() }, validated_hash: o.configHash, validated_at: new Date().toISOString(), status, submitted_by: null, submitted_at: null },
  );
  await syncCatalogStatus(tenantId, applicationId, passed ? "VALIDATING" : "CONFIGURING", Boolean(o.config.integrationId));
  await audit(tenantId, actorId, applicationId, "validated", { passed, blockingFailures: result.blockingFailures, automationReady: result.automationReady, configVersion: o.configVersion });
  return updated;
}

/**
 * Plays promotion against the accounts the connector already imported,
 * without changing them (spec §8.6). Success submits the configuration for
 * approval by someone else.
 */
export async function simulateOnboarding(tenantId: string, actorId: string, applicationId: string): Promise<ApplicationOnboarding> {
  const { o, row } = await requireOnboarding(tenantId, applicationId);
  const reason = blockReason("simulate", stateOf(o, row), actorId);
  if (reason) throw new ApiError(409, "INVALID_STAGE", reason);
  const app = await getApplicationDetail(tenantId, applicationId);
  if (!app) throw new ApiError(404, "NOT_FOUND", "No such application");
  const [accounts, identities] = await Promise.all([
    o.config.integrationId
      ? getNormalizedObjects(tenantId, o.config.integrationId, "account").then((objs) =>
          objs.map((x) => ({ externalId: x.externalId, ...(x.raw as Record<string, unknown>), normalized: x.normalized })),
        )
      : Promise.resolve([] as Record<string, unknown>[]),
    listIdentitiesForCorrelation(tenantId, ["HUMAN", "EXTERNAL", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API", "MACHINE"]),
  ]);
  const result = runSimulation(o.config, accounts, identities, await discoveredEntitlementCount(tenantId, o.config, app));
  const now = new Date().toISOString();
  const updated = await transition(
    tenantId,
    applicationId,
    { configHash: o.configHash },
    {
      simulation_results: { ...result, at: now },
      simulated_hash: o.configHash,
      simulated_at: now,
      status: result.passed ? "WAITING_FOR_APPROVAL" : "FAILED",
      submitted_by: result.passed ? actorId : null,
      submitted_at: result.passed ? now : null,
      approved_by: null,
      approved_at: null,
      approved_hash: null,
      approved_config: null,
      decision_note: null,
    },
  );
  await syncCatalogStatus(tenantId, applicationId, result.passed ? "WAITING_FOR_APPROVAL" : "FAILED", Boolean(o.config.integrationId));
  await audit(tenantId, actorId, applicationId, "simulated", {
    passed: result.passed,
    accounts: result.accounts,
    correlated: result.correlated,
    unmatched: result.unmatched,
    ambiguous: result.ambiguous,
    missingIdentifier: result.missingIdentifier,
    configVersion: o.configVersion,
  });
  return updated;
}

export async function decideOnboarding(
  tenantId: string,
  actorId: string,
  applicationId: string,
  decision: { approve: boolean; note?: unknown },
  actorIsAdmin = false,
): Promise<ApplicationOnboarding> {
  const { o, row } = await requireOnboarding(tenantId, applicationId);
  const reason = blockReason(decision.approve ? "approve" : "reject", stateOf(o, row), actorId, { actorIsAdmin });
  if (reason) throw new ApiError(409, "INVALID_STAGE", reason);
  const note = typeof decision.note === "string" && decision.note.trim() ? decision.note.trim().slice(0, 2000) : null;
  if (!decision.approve && !note) throw new ApiError(400, "VALIDATION_FAILED", "note: say why it is rejected");
  // Owner decision 2026-10-14: an administrator approving their own submission says why; it is marked and audited as such.
  const selfApproved = decision.approve && o.submittedBy === actorId;
  if (selfApproved && !note) throw new ApiError(400, "VALIDATION_FAILED", "note: say why you approve your own submission");
  const now = new Date().toISOString();
  const updated = await transition(
    tenantId,
    applicationId,
    { status: ["WAITING_FOR_APPROVAL"], configHash: o.configHash },
    decision.approve
      ? { status: "APPROVED", approved_by: actorId, approved_at: now, approved_hash: o.configHash, approved_config: o.config, decision_note: note, self_approved: selfApproved }
      : { status: "REJECTED", decision_note: note, submitted_by: null, submitted_at: null },
  );
  await syncCatalogStatus(tenantId, applicationId, decision.approve ? "APPROVED" : "REJECTED", Boolean(o.config.integrationId));
  await audit(
    tenantId,
    actorId,
    applicationId,
    decision.approve ? "approved" : "rejected",
    { configVersion: o.configVersion, configHash: o.configHash, templateId: o.templateId, answered: Object.keys(o.answers), ...(selfApproved ? { selfApproved: true } : {}) },
    { note },
  );
  return updated;
}

/**
 * Promotes exactly the approved configuration (spec §8.6): the record must
 * still hold the approved hash. The application becomes ACTIVE and, when
 * the approved configuration names an integration, is linked to it.
 */
export async function promoteOnboarding(tenantId: string, actorId: string, applicationId: string): Promise<ApplicationOnboarding> {
  const { o, row } = await requireOnboarding(tenantId, applicationId);
  const reason = blockReason("promote", stateOf(o, row), actorId);
  if (reason) throw new ApiError(409, "INVALID_STAGE", reason);
  const approved = row.approved_config as OnboardingConfig;
  const now = new Date().toISOString();
  const updated = await transition(
    tenantId,
    applicationId,
    { status: ["APPROVED"], configHash: o.approvedHash! },
    { status: "PROMOTED", promoted_config: approved, promoted_hash: o.approvedHash, promoted_at: now },
  );
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("applications")
    .update({ onboarding_status: "ACTIVE", ...(approved.integrationId ? { source_integration_id: approved.integrationId } : {}), updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", applicationId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await audit(tenantId, actorId, applicationId, "promoted", { configVersion: o.configVersion, configHash: o.approvedHash, integrationId: approved.integrationId });
  return updated;
}

/** Catalog lifecycle for a live application: suspend, resume, retire (reason required to take it out). */
export async function setApplicationLifecycle(tenantId: string, actorId: string, applicationId: string, action: unknown, note: unknown): Promise<ApplicationOnboardingStatus> {
  const app = await getApplicationDetail(tenantId, applicationId);
  if (!app) throw new ApiError(404, "NOT_FOUND", "No such application");
  const reason = typeof note === "string" && note.trim() ? note.trim().slice(0, 2000) : null;
  let from: ApplicationOnboardingStatus[];
  let to: ApplicationOnboardingStatus;
  if (action === "suspend") [from, to] = [["ACTIVE"], "SUSPENDED"];
  else if (action === "resume") [from, to] = [["SUSPENDED"], "ACTIVE"];
  else if (action === "retire") [from, to] = [["DISCOVERED", "CONFIGURING", "CONNECTED", "VALIDATING", "SIMULATION_FAILED", "READY_FOR_APPROVAL", "APPROVED", "ACTIVE", "SUSPENDED"], "RETIRED"];
  else throw new ApiError(400, "VALIDATION_FAILED", "action: suspend, resume or retire");
  if (!from.includes(app.onboardingStatus)) throw new ApiError(409, "INVALID_STAGE", `A ${app.onboardingStatus.toLowerCase()} application cannot be ${action === "resume" ? "resumed" : `${action}d`}`);
  if (to !== "ACTIVE" && !reason) throw new ApiError(400, "VALIDATION_FAILED", "note: give the reason");
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("applications")
    // WID-H07: the reason is kept on the application, not in the audit row.
    .update({ onboarding_status: to, lifecycle_note: reason || null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", applicationId)
    .eq("onboarding_status", app.onboardingStatus)
    .select("id");
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!data?.length) throw new ApiError(409, "CONFLICT", "The application changed meanwhile; reload and try again");
  await writeAudit({ tenantId, actorId, actorType: "user", action: `application.${action === "resume" ? "resumed" : `${action}d`}`, objectType: "application", objectId: applicationId, outcome: "success", metadata: { from: app.onboardingStatus, to }, typedText: { reason: reason || null } });
  return to;
}
