import "server-only";

/**
 * The published contract for the Compliance Agent's module
 * (docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md). Other modules must import
 * from this file only — never query certification_campaigns/
 * control_mappings/etc. directly.
 */

export { launchCampaign, listCampaigns, listCampaignItems, getCampaignMetrics, type LaunchCampaignInput } from "./campaigns";
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
export { escalateOverdueItems } from "./escalation";
export { exportCampaignEvidence } from "./export";
