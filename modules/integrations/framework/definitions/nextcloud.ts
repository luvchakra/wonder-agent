import type { ConnectorDefinition } from "../types";

const ocs = { "OCS-APIRequest": "true", Accept: "application/json" };

/** Nextcloud: accounts (administrators flagged), groups and group membership, through the OCS provisioning API. */
export const nextcloud: ConnectorDefinition = {
  schemaVersion: 1,
  key: "nextcloud",
  version: "1.0.0",
  name: "Nextcloud",
  vendor: "Nextcloud",
  category: "application",
  description:
    "File-sharing accounts (disabled accounts and administrators flagged, last sign-in), groups, and who is in which group. Nextcloud has no read-only administrator: use an administrator's app password, which can be revoked on its own.",
  documentationUrl: "https://docs.nextcloud.com/server/latest/admin_manual/configuration_user/instruction_set_for_users.html",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Nextcloud address", type: "url", required: true, help: "For example https://files.example.com" }],
  auth: {
    type: "basic",
    username: "{secret.username}",
    password: "{secret.appPassword}",
    fields: [
      { key: "username", label: "Username", help: "An administrator" },
      { key: "appPassword", label: "App password", help: "Personal settings → Security → Create new app password" },
    ],
  },
  test: { request: { path: "/ocs/v2.php/cloud/user", headers: ocs } },
  application: "Nextcloud",
  rateLimitPerSecond: 10,
  resources: {
    account: {
      request: { path: "/ocs/v2.php/cloud/users/details", headers: ocs },
      records: "ocs.data.users",
      recordsKeyed: true,
      pagination: { type: "offset", param: "offset", sizeParam: "limit", size: 100 },
      fields: {
        externalId: "id",
        username: "id",
        email: { path: "email", transform: ["lower"] },
        owner: { path: "email", transform: ["lower"] },
        displayName: "displayname",
        status: { path: "enabled", transform: [{ map: { true: "active", false: "disabled" }, default: "active" }] },
        privileged: { path: "groups", transform: [{ contains: "admin" }] },
        lastLoginAt: { path: "lastLogin", transform: [{ map: { "0": null } }, "date"] },
      },
    },
    entitlement: {
      request: { path: "/ocs/v2.php/cloud/groups/details", headers: ocs },
      records: "ocs.data.groups",
      pagination: { type: "offset", param: "offset", sizeParam: "limit", size: 100 },
      fields: {
        externalId: "id",
        name: "displayname",
        type: { value: "group" },
        privilegeLevel: { path: "id", transform: [{ map: { admin: "admin" }, default: "standard" }] },
      },
    },
    access_grant: {
      forEach: "entitlement",
      request: { path: "/ocs/v2.php/cloud/groups/{parent.id}/users", headers: ocs },
      records: "ocs.data.users",
      fields: {
        externalId: { template: "{parent.id}:{record.value}" },
        accountExternalId: "value",
        entitlementExternalId: "parent.id",
        grantType: { value: "group" },
      },
    },
  },
};
