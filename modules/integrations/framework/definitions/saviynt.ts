import type { ConnectorDefinition } from "../types";

// Saviynt EIC v5: every list call is a POST with max/offset in the JSON body.
const page = { type: "offset", param: "offset", sizeParam: "max", size: 100, in: "body" } as const;
const post = (path: string) => ({ method: "POST" as const, path, body: {} });

/**
 * Saviynt Enterprise Identity Cloud (API v5). Paths, methods and paging are
 * from Saviynt's API reference v24.2. Its response envelopes are not in that
 * reference, so each resource tries the documented list key first and then
 * a top-level list (`records`).
 */
export const saviynt: ConnectorDefinition = {
  schemaVersion: 1,
  key: "saviynt",
  version: "1.0.0",
  name: "Saviynt",
  vendor: "Saviynt",
  category: "identity_provider",
  description:
    "Identities, accounts, endpoints (applications), entitlements, entitlement assignments and security systems from Saviynt Enterprise Identity Cloud, through its v5 REST API.",
  documentationUrl: "https://docs.saviyntcloud.com/",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Saviynt address", type: "url", required: true, help: "For example https://tenant.saviyntcloud.com" }],
  auth: {
    type: "bearer",
    token: "{secret.token}",
    fields: [{ key: "token", label: "API token", help: "From POST /ECM/api/login or /ECM/oauth/access_token, for a read-only API user" }],
  },
  test: { request: { method: "POST", path: "/ECM/api/v5/getSecuritySystems", body: { max: 1, offset: 0 } } },
  application: "Saviynt",
  rateLimitPerSecond: 5,
  resources: {
    identity: {
      request: post("/ECM/api/v5/getUser"),
      records: ["userlist", "userdetails", ""],
      pagination: page,
      fields: {
        externalId: { path: ["username", "id"] },
        username: "username",
        displayName: { path: ["displayname", "displayName"] },
        firstName: "firstname",
        lastName: "lastname",
        email: { path: "email", transform: ["lower"] },
        identityType: { value: "service_account" },
      },
    },
    account: {
      request: post("/ECM/api/v5/getAccounts"),
      records: ["Accountdetails", "accountdetails", ""],
      pagination: page,
      fields: {
        externalId: { path: ["name", "accountID", "id"] },
        username: "name",
        application: { path: ["endpoint", "endpointname"] },
        owner: "accountowner",
        entitlements: "entitlements",
      },
    },
    application: {
      request: post("/ECM/api/v5/getEndpoints"),
      records: ["Endpoints", "endpoints", ""],
      pagination: page,
      fields: {
        externalId: { path: ["endpointkey", "endpointname", "id"] },
        name: { path: ["endpointname", "displayName"] },
        category: "connectionType",
      },
    },
    entitlement: {
      request: post("/ECM/api/v5/getEntitlements"),
      records: ["Entitlementdetails", "entitlementdetails", ""],
      pagination: page,
      fields: {
        externalId: { path: ["entitlement_valuekey", "entitlementID", "entitlement_value", "id"] },
        name: { path: ["entitlement_value", "displayname"] },
        application: { path: ["endpoint", "endpointname"] },
        dataClassification: "dataclassification",
        privilegeLevel: { path: "privilegelevel", default: "standard" },
      },
    },
    access_grant: {
      request: post("/ECM/api/v5/getEntDetailsforUsers"),
      records: ["Entitlementdetails", "result", ""],
      pagination: page,
      fields: {
        externalId: { template: "{record.accountname}{record.username}:{record.entitlement_value}{record.entitlementname}" },
        accountExternalId: { path: ["accountname", "username"] },
        entitlementExternalId: { path: ["entitlement_value", "entitlementname"] },
        grantType: { path: "assignmenttype", default: "direct" },
      },
    },
    policy: {
      request: post("/ECM/api/v5/getSecuritySystems"),
      records: ["securitySystemDetails", "securitysystemdetails", ""],
      pagination: page,
      fields: {
        externalId: { path: ["systemname", "id"] },
        name: { path: ["systemname", "name"] },
        type: { value: "security_system" },
        description: "description",
      },
    },
  },
};
