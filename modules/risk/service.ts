import "server-only";

/**
 * The published contract for the Risk Agent's module
 * (docs/plan/06-RISK-AGENT-BACKLOG.md). Other modules must import from this
 * file only — never query risk_findings/risk_evidence directly.
 */

export { getFindings, getFinding, getFindingAsOfDetection, assignFinding, remediateFinding, resolveFinding, transitionFindingStatus } from "./findings";
export { evaluateAgentRisk } from "./rules";
// ACCESS-P0-25: findings about access on an account, for any identity type.
export { syncRogueAccessFindings, listAccessFindings, countOpenAccessFindings, accessSubjectKey } from "./accessFindings";
export { requestAccessFindingRemoval } from "./accessRemediation";
export { remediationLabel } from "./accessRemediationRules";
export {
  createInvestigation,
  validateCreateInvestigation,
  changeInvestigationStatus,
  assignInvestigation,
  addFindingToInvestigation,
  removeFindingFromInvestigation,
  addInvestigationNote,
  listInvestigations,
  getInvestigation,
  type CreateInvestigationInput,
} from "./investigations";
