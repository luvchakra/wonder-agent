import "server-only";

/**
 * The published contract for the Identity Agent's module
 * (docs/plan/02-IDENTITY-AGENT-BACKLOG.md). Other modules (Access, Runtime,
 * Risk, Compliance, Experience) must import from this file only — never
 * query agents/agent_contracts/agent_owners/etc. directly, and never import
 * from a sibling file under modules/agent-identity/* directly, so this
 * module's internal schema can evolve without breaking consumers.
 */

export { createAgent, getAgent, listAgents, type CreateAgentInput } from "./agents";
export {
  getAgentContract,
  listContractVersions,
  createContractVersion,
  type ContractInput,
} from "./contracts";
export {
  transitionAgentLifecycle,
  listLifecycleEvents,
  isStructurallyAllowedTransition,
  type LifecycleActor,
} from "./lifecycle";
export { assignOwner, removeOwner, listOwners, getOwnershipIssues } from "./owners";
export { linkAgentIdentity, listAgentIdentities } from "./identities";
export { addRelationship, listRelationships, removeRelationship } from "./relationships";
