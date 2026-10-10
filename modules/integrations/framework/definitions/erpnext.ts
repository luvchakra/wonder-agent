import type { ConnectorDefinition } from "../types";

/** ERPNext (or any Frappe app): application users, roles, and which user holds which role. */
export const erpnext: ConnectorDefinition = {
  schemaVersion: 1,
  key: "erpnext",
  version: "1.0.0",
  name: "ERPNext",
  vendor: "Frappe",
  category: "application",
  description: "ERPNext users, roles and role assignments, for access reviews and segregation-of-duties checks (for example creating suppliers and approving payments).",
  documentationUrl: "https://docs.frappe.io/framework/user/en/api/rest",
  driver: "http",
  settings: [{ key: "baseUrl", label: "ERPNext address", type: "url", required: true }],
  auth: {
    type: "header",
    name: "Authorization",
    value: "token {secret.apiKey}:{secret.apiSecret}",
    fields: [
      { key: "apiKey", label: "API key", help: "From a user whose role can read Role, and User at permission levels 0 and 1 (level 1 holds roles)" },
      { key: "apiSecret", label: "API secret" },
    ],
  },
  test: { request: { path: "/api/method/frappe.auth.get_logged_user" } },
  application: "ERPNext",
  rateLimitPerSecond: 10,
  resources: {
    account: {
      request: { path: "/api/resource/User", query: { fields: '["name","full_name","enabled","user_type","last_login","creation"]', order_by: "name asc" } },
      records: "data",
      pagination: { type: "offset", param: "limit_start", sizeParam: "limit_page_length", size: 500 },
      where: [{ path: "name", notIn: ["Administrator", "Guest"] }, { path: "user_type", notEquals: "Website User" }],
      fields: {
        externalId: "name",
        username: "name",
        email: { path: "name", transform: ["lower"] },
        owner: { path: "name", transform: ["lower"] },
        displayName: "full_name",
        status: { path: "enabled", transform: [{ map: { "1": "active", "0": "disabled" }, default: "active" }] },
        lastLoginAt: "last_login",
        createdAt: "creation",
        accountType: { value: "human" },
      },
    },
    entitlement: {
      request: { path: "/api/resource/Role", query: { fields: '["name","desk_access","disabled"]', order_by: "name asc" } },
      records: "data",
      pagination: { type: "offset", param: "limit_start", sizeParam: "limit_page_length", size: 500 },
      where: [{ path: "name", notIn: ["All", "Guest", "Administrator", "Desk User"] }],
      fields: {
        externalId: "name",
        name: "name",
        type: { value: "role" },
        privilegeLevel: { path: "name", transform: [{ map: { "System Manager": "admin", "Accounts Manager": "elevated", "Purchase Manager": "elevated", "HR Manager": "elevated", "Stock Manager": "elevated" }, default: "standard" }] },
      },
    },
    access_grant: {
      forEach: "account",
      request: { path: "/api/resource/User/{parent.name}" },
      records: "data.roles",
      fields: {
        externalId: { template: "{parent.name}:{record.role}" },
        accountExternalId: "parent.name",
        entitlementExternalId: "role",
        grantType: { value: "direct" },
      },
    },
  },
};
