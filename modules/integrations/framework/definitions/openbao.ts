import type { ConnectorDefinition } from "../types";

/** OpenBao (and HashiCorp Vault): AppRoles and userpass logins, ACL policies, and the policies each login receives. */
export const openbao: ConnectorDefinition = {
  schemaVersion: 1,
  key: "openbao",
  version: "1.0.0",
  name: "OpenBao / Vault",
  vendor: "OpenBao",
  category: "secrets",
  description:
    "Machine logins (AppRoles) and people's logins (userpass), the ACL policies, and which policies each login's tokens receive. Never reads a secret: the reader's policy grants list and read on configuration paths only.",
  documentationUrl: "https://openbao.org/api-docs/",
  driver: "http",
  settings: [
    { key: "baseUrl", label: "OpenBao or Vault address", type: "url", required: true, help: "For example https://vault.example.com" },
    { key: "approleMount", label: "AppRole mount", type: "string", default: "approle" },
    { key: "userpassMount", label: "Userpass mount", type: "string", default: "userpass" },
  ],
  auth: {
    type: "header",
    name: "X-Vault-Token",
    value: "{secret.token}",
    fields: [
      {
        key: "token",
        label: "Token",
        help: "A token whose policy allows only read and list on sys/policies/acl, auth/<approle>/role and auth/<userpass>/users",
      },
    ],
  },
  test: { request: { path: "/v1/auth/token/lookup-self" } },
  application: "OpenBao",
  rateLimitPerSecond: 20,
  resources: {
    account: [
      {
        request: { path: "/v1/auth/{settings.approleMount}/role", query: { list: "true" } },
        records: "data.keys",
        optional: true,
        fields: {
          externalId: { template: "approle:{record.value}" },
          username: "value",
          displayName: { template: "AppRole {record.value}" },
          accountType: { value: "service" },
          status: { value: "active" },
        },
      },
      {
        request: { path: "/v1/auth/{settings.userpassMount}/users", query: { list: "true" } },
        records: "data.keys",
        optional: true,
        fields: {
          externalId: { template: "userpass:{record.value}" },
          username: "value",
          displayName: "value",
          accountType: { value: "human" },
          status: { value: "active" },
        },
      },
    ],
    entitlement: {
      request: { path: "/v1/sys/policies/acl", query: { list: "true" } },
      records: "data.keys",
      where: [{ path: "value", notIn: ["default", "root"] }],
      fields: {
        externalId: { template: "policy:{record.value}" },
        name: "value",
        type: { value: "policy" },
      },
    },
    access_grant: [
      {
        forEach: "account",
        forEachRequest: 0,
        request: { path: "/v1/auth/{settings.approleMount}/role/{parent.value}" },
        records: "data.token_policies",
        where: [{ path: "value", notIn: ["default"] }],
        fields: {
          externalId: { template: "approle:{parent.value}:{record.value}" },
          accountExternalId: { template: "approle:{parent.value}" },
          entitlementExternalId: { template: "policy:{record.value}" },
          grantType: { value: "direct" },
        },
      },
      {
        forEach: "account",
        forEachRequest: 1,
        request: { path: "/v1/auth/{settings.userpassMount}/users/{parent.value}" },
        records: "data.token_policies",
        where: [{ path: "value", notIn: ["default"] }],
        fields: {
          externalId: { template: "userpass:{parent.value}:{record.value}" },
          accountExternalId: { template: "userpass:{parent.value}" },
          entitlementExternalId: { template: "policy:{record.value}" },
          grantType: { value: "direct" },
        },
      },
    ],
  },
};
