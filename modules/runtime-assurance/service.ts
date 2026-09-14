import "server-only";

/**
 * The published contract for the Runtime Agent's module
 * (docs/plan/05-RUNTIME-AGENT-BACKLOG.md). Other modules must import from
 * this file only — never query runtime_events/runtime_tools/runtime_resources
 * directly.
 */

export { ingestRuntimeEvent, listRuntimeEvents, computeDedupeKey } from "./events";
export { getDid } from "./did";
export { compareShouldCanDid } from "./compare";
