import type { ConnectorDefinition } from "../types";

const page = { type: "cursor", param: "page[after]", from: "meta.after_cursor", sizeParam: "page[size]", size: 100 } as const;

/** Zendesk Support: staff accounts (agents and admins), groups and group membership. */
export const zendesk: ConnectorDefinition = {
  schemaVersion: 1,
  key: "zendesk",
  version: "1.0.0",
  name: "Zendesk",
  vendor: "Zendesk",
  category: "application",
  description: "Zendesk Support staff: agents and admins (end users left out), groups, and who is in which group.",
  documentationUrl: "https://developer.zendesk.com/api-reference/",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Zendesk address", type: "url", required: true, help: "For example https://yourcompany.zendesk.com" }],
  auth: {
    type: "basic",
    username: "{secret.email}/token",
    password: "{secret.apiToken}",
    fields: [
      { key: "email", label: "Admin email" },
      { key: "apiToken", label: "API token", help: "Admin Center → Apps and integrations → Zendesk API" },
    ],
  },
  test: { request: { path: "/api/v2/users/me.json" } },
  application: "Zendesk",
  rateLimitPerSecond: 5,
  resources: {
    account: {
      request: { path: "/api/v2/users.json", query: { "role[]": ["agent", "admin"] } },
      records: "users",
      pagination: page,
      fields: {
        externalId: "id",
        username: "email",
        email: { path: "email", transform: ["lower"] },
        owner: { path: "email", transform: ["lower"] },
        displayName: "name",
        status: { path: "suspended", transform: [{ map: { true: "suspended", false: "active" }, default: "active" }] },
        privileged: { path: "role", transform: [{ map: { admin: true }, default: false }] },
        lastLoginAt: { path: "last_login_at", transform: ["date"] },
        createdAt: { path: "created_at", transform: ["date"] },
      },
    },
    entitlement: {
      request: { path: "/api/v2/groups.json" },
      records: "groups",
      pagination: page,
      fields: { externalId: "id", name: "name", type: { value: "group" }, description: "description" },
    },
    access_grant: {
      request: { path: "/api/v2/group_memberships.json" },
      records: "group_memberships",
      pagination: page,
      fields: {
        externalId: "id",
        accountExternalId: "user_id",
        entitlementExternalId: "group_id",
        grantType: { value: "group" },
      },
    },
  },
};
