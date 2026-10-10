import type { ConnectorDefinition } from "../types";

const page = { type: "offset", param: "first", sizeParam: "max", size: 100 } as const;

/** Keycloak: one realm's accounts (people and service accounts), groups, realm roles and who holds which. */
export const keycloak: ConnectorDefinition = {
  schemaVersion: 1,
  key: "keycloak",
  version: "1.0.0",
  name: "Keycloak",
  vendor: "Keycloak",
  category: "identity_provider",
  description:
    "Accounts in one Keycloak realm, including the service accounts behind clients and AI agents, with their groups and realm roles. Read only, through a confidential client's service account.",
  documentationUrl: "https://www.keycloak.org/docs-api/latest/rest-api/index.html",
  driver: "http",
  settings: [
    { key: "baseUrl", label: "Keycloak address", type: "url", required: true, help: "For example https://sso.example.com" },
    { key: "realm", label: "Realm", type: "string", required: true },
  ],
  auth: {
    type: "oauth2_client_credentials",
    tokenUrl: "{settings.baseUrl}/realms/{settings.realm}/protocol/openid-connect/token",
    clientId: "{secret.clientId}",
    clientSecret: "{secret.clientSecret}",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        help: "A confidential client with service accounts on, whose service account holds realm-management view-users, query-users, view-realm, view-clients and query-groups",
      },
      { key: "clientSecret", label: "Client secret" },
    ],
  },
  test: { request: { path: "/admin/realms/{settings.realm}/users/count" } },
  application: "Keycloak ({settings.realm})",
  rateLimitPerSecond: 25,
  resources: {
    account: {
      // exact=false makes Keycloak include service-account users, which a plain listing leaves out.
      request: { path: "/admin/realms/{settings.realm}/users", query: { briefRepresentation: "false", exact: "false" } },
      records: "",
      pagination: page,
      fields: {
        externalId: "id",
        username: "username",
        email: { path: "email", transform: ["lower"] },
        owner: { path: "email", transform: ["lower"] },
        displayName: "username",
        status: { path: "enabled", transform: [{ map: { true: "active", false: "disabled" }, default: "active" }] },
        // A list entry has no serviceAccountClientId; Keycloak names these users service-account-<client>.
        accountType: { path: "username", transform: [{ prefix: "service-account-" }, { map: { true: "service", false: "human" } }] },
        createdAt: { path: "createdTimestamp", transform: ["date"] },
        expiresAt: { path: "attributes.endDate", transform: ["first", "date"] },
      },
    },
    entitlement: [
      {
        request: { path: "/admin/realms/{settings.realm}/groups", query: { briefRepresentation: "false" } },
        records: "",
        pagination: page,
        fields: {
          externalId: { template: "group:{record.id}" },
          name: "path",
          type: { value: "group" },
          description: { path: "attributes.description", transform: ["first"] },
        },
      },
      {
        request: { path: "/admin/realms/{settings.realm}/roles", query: { briefRepresentation: "false" } },
        records: "",
        pagination: page,
        where: [{ path: "name", notIn: ["offline_access", "uma_authorization"] }],
        fields: {
          externalId: { template: "role:{record.id}" },
          name: "name",
          type: { value: "role" },
          description: "description",
        },
      },
    ],
    access_grant: [
      {
        forEach: "account",
        request: { path: "/admin/realms/{settings.realm}/users/{parent.id}/groups" },
        records: "",
        pagination: page,
        fields: {
          externalId: { template: "{parent.id}:group:{record.id}" },
          accountExternalId: "parent.id",
          entitlementExternalId: { template: "group:{record.id}" },
          grantType: { value: "group" },
        },
      },
      {
        forEach: "account",
        request: { path: "/admin/realms/{settings.realm}/users/{parent.id}/role-mappings/realm" },
        records: "",
        where: [{ path: "name", notIn: ["offline_access", "uma_authorization"] }],
        fields: {
          externalId: { template: "{parent.id}:role:{record.id}" },
          accountExternalId: "parent.id",
          entitlementExternalId: { template: "role:{record.id}" },
          grantType: { value: "direct" },
        },
      },
    ],
  },
};
