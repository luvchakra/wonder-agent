import type { ConnectorDefinition } from "../types";

const page = { type: "page", param: "page", sizeParam: "per_page", size: 200, start: 0 } as const;

/** Mattermost: accounts (people and bots, system administrators flagged) and team membership. */
export const mattermost: ConnectorDefinition = {
  schemaVersion: 1,
  key: "mattermost",
  version: "1.0.0",
  name: "Mattermost",
  vendor: "Mattermost",
  category: "application",
  description:
    "Chat accounts (people and bots, with deactivated accounts and system administrators flagged), teams, and who is in which team. Needs no administrator: an ordinary member of every team reads it.",
  documentationUrl: "https://developers.mattermost.com/api-documentation/",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Mattermost address", type: "url", required: true, help: "For example https://chat.example.com" }],
  auth: {
    type: "bearer",
    token: "{secret.token}",
    fields: [{ key: "token", label: "Personal access token", help: "Of a non-admin user who is a member of every team; teams it is not in are not read" }],
  },
  test: { request: { path: "/api/v4/users/me" } },
  application: "Mattermost",
  rateLimitPerSecond: 10,
  resources: {
    account: {
      request: { path: "/api/v4/users" },
      records: "",
      pagination: page,
      fields: {
        externalId: "id",
        username: "username",
        email: { path: "email", transform: ["lower"] },
        owner: { path: "email", transform: ["lower"] },
        displayName: "username",
        status: { path: "delete_at", transform: [{ map: { "0": "active" }, default: "disabled" }] },
        accountType: { path: "is_bot", transform: [{ map: { true: "service" }, default: "human" }] },
        privileged: { path: "roles", transform: [{ contains: "system_admin" }] },
        createdAt: { path: "create_at", transform: ["date"] },
      },
    },
    entitlement: {
      request: { path: "/api/v4/users/me/teams" },
      records: "",
      fields: {
        externalId: "id",
        name: "display_name",
        type: { value: "team" },
        description: "description",
      },
    },
    access_grant: {
      // A non-admin sees only its own row in /teams/{id}/members, but every member through users?in_team.
      forEach: "entitlement",
      request: { path: "/api/v4/users", query: { in_team: "{parent.id}" } },
      records: "",
      pagination: page,
      fields: {
        externalId: { template: "{parent.id}:{record.id}" },
        accountExternalId: "id",
        entitlementExternalId: "parent.id",
        grantType: { value: "direct" },
      },
    },
  },
};
