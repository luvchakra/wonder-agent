import "server-only";

/**
 * The published contract for the Compliance Agent's module
 * (docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md). Other modules must import
 * from this file only — never query certification_campaigns/
 * control_mappings/etc. directly.
 */

export { launchCampaign, getCampaign, listCampaigns, listCampaignItems, listCampaignItemsPage, getCampaignMetrics, campaignItemCounts, failStaleCampaignBuilds, previewCampaign, type CampaignPreview, type LaunchCampaignInput } from "./campaigns";
export { listRevocations, type RevocationRow } from "./revocations";
export { askConsultation, answerConsultation, listConsultationsForItem, getConsultationForAnswer, type Consultation } from "./consultations";
export { listCampaignTemplates, saveCampaignTemplate, archiveCampaignTemplate, launchCampaignFromTemplate, type CampaignTemplate } from "./templates";
export {
  recordDecision,
  listDecisionsForItem,
  getCertificationItemDetail,
  getCertificationHistory,
  type RecordDecisionInput,
} from "./decisions";
export {
  listControlFrameworks,
  listControls,
  createControlMapping,
  listControlMappings,
  listControlEvidence,
  addControlEvidence,
  recomputeStaleControlMappings,
} from "./controls";
export { escalateOverdueItems, escalateOverdueItemsForAllTenants, type EscalationSweepResult } from "./escalation";
export { exportCampaignEvidence } from "./export";
export { getGovernancePosture } from "./posture";
export {
  recordAttestation,
  listAttestationsForAgent,
  getLatestAttestation,
  type RecordAttestationInput,
} from "./attestations";
export { assembleGovernanceEvidencePack } from "./evidencePack";
export { countOverdueCertificationItems } from "./overdue";
// COMPLIANCE-P0-10 (remainder): the campaign calendar and analytics.
export { summarizeCampaigns, campaignCalendar, OUTCOME_LABEL, type CampaignAnalytics, type CalendarMonth, type DecisionCount } from "./analytics";
export { listCampaignDecisionCounts, listReviewerBacklog, type ReviewerBacklog } from "./analyticsService";
