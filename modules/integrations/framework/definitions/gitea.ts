import type { ConnectorDefinition } from "../types";

const page = { type: "link_header", sizeParam: "limit", size: 50 } as const;

/** Gitea (and Forgejo): every account on the instance, one organization's teams, and team membership. */
export const gitea: ConnectorDefinition = {
  schemaVersion: 1,
  key: "gitea",
  version: "1.0.0",
  name: "Gitea",
  vendor: "Gitea",
  category: "application",
  description:
    "Source-control accounts (people and bots, with site administrators flagged), an organization's teams with their permission level, and who is in which team.",
  documentationUrl: "https://docs.gitea.com/api/next/",
  driver: "http",
  settings: [
    { key: "baseUrl", label: "Gitea address", type: "url", required: true, help: "For example https://git.example.com" },
    { key: "organization", label: "Organization", type: "string", required: true },
  ],
  auth: {
    type: "header",
    name: "Authorization",
    value: "token {secret.token}",
    fields: [{ key: "token", label: "Access token", help: "A site administrator's token with read:admin, read:organization, read:repository and read:user only" }],
  },
  test: { request: { path: "/api/v1/user" } },
  application: "Gitea",
  rateLimitPerSecond: 20,
  resources: {
    account: {
      request: { path: "/api/v1/admin/users" },
      records: "",
      pagination: page,
      fields: {
        externalId: "id",
        username: "login",
        email: { path: "email", transform: ["lower"] },
        owner: { path: "email", transform: ["lower"] },
        displayName: "full_name",
        status: { path: "prohibit_login", transform: [{ map: { true: "disabled", false: "active" }, default: "active" }] },
        privileged: "is_admin",
        // Gitea reports "never" as the zero time.
        lastLoginAt: { path: "last_login", transform: [{ map: { "0001-01-01T00:00:00Z": null } }, "date"] },
        createdAt: { path: "created", transform: ["date"] },
      },
    },
    entitlement: {
      request: { path: "/api/v1/orgs/{settings.organization}/teams" },
      records: "",
      pagination: page,
      fields: {
        externalId: { template: "team:{record.id}" },
        name: { template: "{settings.organization}/{record.name}" },
        type: { value: "team" },
        description: "description",
        privilegeLevel: { path: "permission", transform: [{ map: { owner: "admin", admin: "admin", write: "elevated", read: "standard" }, default: "standard" }] },
      },
    },
    access_grant: {
      forEach: "entitlement",
      request: { path: "/api/v1/teams/{parent.id}/members" },
      records: "",
      pagination: page,
      fields: {
        externalId: { template: "team:{parent.id}:{record.id}" },
        accountExternalId: "id",
        entitlementExternalId: { template: "team:{parent.id}" },
        grantType: { value: "group" },
      },
    },
  },
};
