import type { ConnectorDefinition } from "../types";

const page = { type: "scim", size: 100 } as const;
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

/**
 * INTEGRATION-P0-22: any application with a SCIM 2.0 service (RFC 7643 and
 * RFC 7644): its users and groups, who is in which group, and, when an
 * administrator turns changes on, adding and removing group members,
 * disabling a user and creating one. The base address is the SCIM root,
 * the one that ends in /scim/v2 or similar.
 */
export const scim: ConnectorDefinition = {
  schemaVersion: 1,
  key: "scim-2",
  version: "1.0.0",
  name: "SCIM 2.0 application",
  vendor: "SCIM",
  category: "application",
  description:
    "Users and groups of any application that offers a SCIM 2.0 service, with group membership. Can add and remove group members, disable users and create them, once an administrator turns changes on for the connection.",
  documentationUrl: "https://www.rfc-editor.org/rfc/rfc7644",
  driver: "http",
  settings: [
    { key: "baseUrl", label: "SCIM address", type: "url", required: true, help: "The SCIM root, for example https://app.example.com/scim/v2" },
    { key: "application", label: "Application name", type: "string", required: true, help: "How this application is named in WonderID" },
  ],
  auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "SCIM token", help: "A bearer token the application issues for its SCIM service" }] },
  test: { request: { path: "/ServiceProviderConfig" } },
  application: "{settings.application}",
  rateLimitPerSecond: 10,
  resources: {
    account: {
      request: { path: "/Users" },
      pagination: page,
      fields: {
        externalId: "id",
        username: "userName",
        email: { path: ["emails[0].value", "userName"], transform: ["lower"] },
        displayName: { path: ["displayName", "name.formatted", "userName"] },
        status: { path: "active", transform: [{ map: { true: "active", false: "disabled" }, default: "active" }] },
        createdAt: { path: "meta.created", transform: ["date"] },
      },
    },
    entitlement: {
      request: { path: "/Groups" },
      pagination: page,
      fields: { externalId: "id", name: "displayName", type: { value: "group" } },
    },
    access_grant: {
      request: { path: "/Groups" },
      pagination: page,
      unwind: "members",
      fields: {
        externalId: { template: "{parent.id}:{record.value}" },
        accountExternalId: "value",
        entitlementExternalId: "parent.id",
      },
    },
  },
  write: {
    // RFC 7644 §3.5.2: group membership changes by PATCH on the group.
    grant_access: {
      request: { method: "PATCH", path: "/Groups/{target.entitlement}", body: { schemas: [PATCH], Operations: [{ op: "add", path: "members", value: [{ value: "{target.account}" }] }] } },
    },
    revoke_access: {
      request: { method: "PATCH", path: "/Groups/{target.entitlement}", body: { schemas: [PATCH], Operations: [{ op: "remove", path: 'members[value eq "{target.account}"]' }] } },
    },
    disable_account: {
      request: { method: "PATCH", path: "/Users/{target.account}", body: { schemas: [PATCH], Operations: [{ op: "replace", path: "active", value: false }] } },
    },
    create_account: {
      request: {
        method: "POST",
        path: "/Users",
        body: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "{target.email}",
          displayName: "{target.displayName}",
          emails: [{ value: "{target.email}", primary: true }],
          active: true,
        },
      },
    },
  },
};
