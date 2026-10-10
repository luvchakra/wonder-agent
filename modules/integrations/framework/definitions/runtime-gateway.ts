import type { ConnectorDefinition } from "../types";
import { WONDERID_RUNTIME_EVENT_FIELDS } from "./runtime-event-fields";

/** An AI agent runtime: its agents ask WonderID before they act, and it reports what they did. */
export const runtimeGateway: ConnectorDefinition = {
  schemaVersion: 1,
  key: "runtime-gateway",
  version: "1.0.0",
  name: "Agent runtime",
  category: "ai_runtime",
  description:
    "Connects an AI agent runtime. Its agents ask the Runtime Gateway whether an action is allowed and which tools they may see, using their own agent API keys, and the runtime reports agent activity.",
  driver: "none",
  settings: [],
  auth: { type: "none" },
  resources: {},
  receive: {
    gateway: { authorize: true, toolsFilter: true },
    runtimeEvents: { source: "rest", auth: "bearer", fields: WONDERID_RUNTIME_EVENT_FIELDS },
  },
};
