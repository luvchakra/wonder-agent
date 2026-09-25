import "server-only";

/**
 * The published contract for the Runtime Agent's module
 * (docs/plan/05-RUNTIME-AGENT-BACKLOG.md). Other modules must import from
 * this file only — never query runtime_events/runtime_tools/runtime_resources
 * directly.
 */

export { ingestRuntimeEvent, listRuntimeEvents, countRuntimeEvents, computeDedupeKey, isWithinReplayWindow } from "./events";
export { getDid } from "./did";
export { compareShouldCanDid } from "./compare";
export { quarantineEvent, listQuarantinedEvents } from "./quarantine";
export { getDataQualityMetrics } from "./dataQuality";

// RUNTIME-P0-15 — the Runtime Gateway.
export { authorizeRuntimeRequest, parseGatewayRequest, getGatewayMode, listRuntimeDecisions, filterGatewayTools } from "./gateway";
// RUNTIME-P0-18 — emergency controls.
export {
  engageEmergencyControl,
  liftEmergencyControl,
  listEmergencyControls,
  loadActiveEmergencyState,
  toEmergencyState,
  EMERGENCY_CONTROL_TYPES,
} from "./emergency";
