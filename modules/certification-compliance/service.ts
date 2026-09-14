import "server-only";

/**
 * The published contract for the Compliance Agent's module
 * (docs/plan/07-COMPLIANCE-AGENT-BACKLOG.md). Other modules must import
 * from this file only — never query certification_campaigns/
 * control_mappings/etc. directly.
 */

export { launchCampaign, listCampaigns, listCampaignItems, type LaunchCampaignInput } from "./campaigns";
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
