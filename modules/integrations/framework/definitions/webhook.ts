import type { ConnectorDefinition } from "../types";

/** Any system that can send signed webhooks: each event is kept as an activity record. */
export const webhook: ConnectorDefinition = {
  schemaVersion: 1,
  key: "webhook",
  version: "1.0.0",
  name: "Webhook",
  category: "event_source",
  description:
    "Receives events from any system that signs its webhooks with HMAC-SHA256. Each event is stored as an activity record of this connection; a redelivered event is stored once.",
  driver: "none",
  settings: [],
  auth: { type: "none" },
  resources: {},
  receive: {
    webhook: { auth: "hmac_sha256", signatureHeader: "x-webhook-signature", externalId: "id" },
  },
};
