import type { ConnectorDefinition } from "../types";

/**
 * INTEGRATION-P0-22 slice 3: an identity provider or HR system that pushes
 * its people to WonderID over SCIM 2.0 (Okta, Microsoft Entra ID, OneLogin,
 * JumpCloud and others). WonderID is the SCIM service provider: the system
 * creates, updates, deactivates and deletes users at the connection's
 * receiver, authenticated by the connection's receiving secret. An identity
 * source reading this connection takes the users in, with its own
 * mappings, correlation and leaver guard.
 */
export const scimInbound: ConnectorDefinition = {
  schemaVersion: 1,
  key: "scim-inbound",
  version: "1.0.0",
  name: "SCIM 2.0 provisioning (incoming)",
  vendor: "SCIM",
  category: "identity_provider",
  description:
    "Receives people from any identity provider or HR system that provisions users over SCIM 2.0. Point the system's SCIM settings at this connection's address and secret; an identity source reading the connection takes the people in.",
  documentationUrl: "https://www.rfc-editor.org/rfc/rfc7644",
  driver: "none",
  settings: [],
  auth: { type: "none" },
  resources: {},
  receive: {
    scim: {
      fields: {
        displayName: { path: ["displayName", "name.formatted", "userName"] },
        firstName: "name.givenName",
        lastName: "name.familyName",
        email: { path: ["emails[0].value", "userName"], transform: ["lower"] },
        username: "userName",
        title: "title",
        department: "enterprise.department",
        organization: "enterprise.organization",
        employmentType: "userType",
        managerExternalId: "enterprise.manager.value",
        status: { path: "active", transform: [{ map: { true: "active", false: "disabled" }, default: "active" }] },
      },
    },
  },
};
