import type { ConnectorDefinition } from "../types";

/** Any LDAP v3 directory (OpenLDAP, 389 Directory Server, Active Directory over LDAPS): accounts, groups, memberships. */
export const ldapDirectory: ConnectorDefinition = {
  schemaVersion: 1,
  key: "ldap-directory",
  version: "1.1.0",
  name: "LDAP directory",
  category: "directory",
  description:
    "Accounts, groups and group memberships from any LDAP v3 directory over LDAPS. Groups use the member attribute (groupOfNames). Can add and remove group members once an administrator turns changes on, if the bind account may change groups.",
  driver: "ldap",
  settings: [
    { key: "url", label: "Directory address", type: "url", required: true, help: "ldaps://directory.example.com:636" },
    { key: "baseDn", label: "Base DN", type: "string", required: true, help: "For example dc=example,dc=com" },
    { key: "userFilter", label: "Account filter", type: "string", default: "(objectClass=inetOrgPerson)" },
    { key: "groupFilter", label: "Group filter", type: "string", default: "(|(objectClass=groupOfNames)(objectClass=group))" },
    { key: "caCertificate", label: "CA certificate (PEM)", type: "string", help: "Only if the directory's certificate comes from an internal certificate authority" },
  ],
  auth: {
    type: "ldap_simple",
    bindDn: "{secret.bindDn}",
    password: "{secret.password}",
    fields: [
      { key: "bindDn", label: "Bind DN", help: "A service account, for example cn=wonderid,ou=services,dc=example,dc=com. Read-only is enough unless changes are turned on; then it must be able to change group membership." },
      { key: "password", label: "Password" },
    ],
  },
  test: { search: { base: "{settings.baseDn}", filter: "(objectClass=*)", scope: "base" } },
  application: "Directory ({settings.baseDn})",
  resources: {
    account: {
      search: { base: "{settings.baseDn}", filter: "{settings.userFilter}", attributes: ["uid", "cn", "mail", "givenName", "sn", "employeeType", "title", "createTimestamp", "modifyTimestamp"] },
      fields: {
        externalId: "dn",
        username: { path: "uid", transform: ["first"] },
        email: { path: "mail", transform: ["first", "lower"] },
        owner: { path: "mail", transform: ["first", "lower"] },
        displayName: { path: "cn", transform: ["first"] },
        status: { value: "active" },
        accountType: { value: "human" },
        createdAt: { path: "createTimestamp", transform: ["date"] },
      },
    },
    entitlement: {
      search: { base: "{settings.baseDn}", filter: "{settings.groupFilter}", attributes: ["cn", "description"] },
      fields: { externalId: "dn", name: { path: "cn", transform: ["first"] }, description: { path: "description", transform: ["first"] }, type: { value: "group" } },
    },
    access_grant: {
      search: { base: "{settings.baseDn}", filter: "{settings.groupFilter}", attributes: ["member"] },
      unwind: "member",
      fields: {
        externalId: { template: "{parent.dn}|{record.value}" },
        accountExternalId: "value",
        entitlementExternalId: "parent.dn",
        grantType: { value: "group" },
      },
    },
  },
  // INTEGRATION-P0-22 (1.1.0): group membership changes; ids are DNs, so the change names them as they are.
  write: {
    grant_access: { ldap: { dn: "{target.entitlement}", modify: [{ operation: "add", attribute: "member", values: ["{target.account}"] }] } },
    revoke_access: { ldap: { dn: "{target.entitlement}", modify: [{ operation: "delete", attribute: "member", values: ["{target.account}"] }] } },
  },
};
