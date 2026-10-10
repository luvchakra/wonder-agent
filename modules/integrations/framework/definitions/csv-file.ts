import type { ConnectorDefinition, FieldMapping, ResourceSpec } from "../types";

/**
 * CSV files: any system that can export a spreadsheet. One file per kind,
 * either fetched from an HTTPS address on the connection's schedule, or
 * sent to the connection (POST /api/connect/v1/<id>/file) or imported from
 * an object page. The tenant's "File imports" connection is one of these.
 *
 * The header row names the columns. By default a column is read as the
 * canonical field of the same name, in any case and ignoring spaces, `_`
 * and `-` ("External ID", "external_id"); common alternatives are accepted
 * too (an identity's id may be "Employee ID"). The `columns` setting renames
 * anything else: `identity.email = Work Email`.
 */

const text = (...paths: string[]): FieldMapping => ({ path: paths });
const lower = (...paths: string[]): FieldMapping => ({ path: paths, transform: ["lower"] });
const date = (...paths: string[]): FieldMapping => ({ path: paths, transform: ["date"] });

function fileResource(urlSetting: string, fields: Record<string, FieldMapping>): ResourceSpec {
  return { file: { url: `{settings.${urlSetting}}`, columns: "{settings.columns}" }, fields };
}

const addressHelp = "Leave empty to send or import files instead.";

export const csvFile: ConnectorDefinition = {
  schemaVersion: 1,
  key: "csv-file",
  version: "1.0.0",
  name: "CSV file",
  category: "other",
  description:
    "Identities, accounts, entitlements, access and applications from CSV files: fetched from an HTTPS address on a schedule, or sent to WonderID. The header row names the columns; each column is read as the field of the same name.",
  driver: "file",
  settings: [
    { key: "identityUrl", label: "Identities CSV address", type: "url", help: addressHelp },
    { key: "accountUrl", label: "Accounts CSV address", type: "url", help: addressHelp },
    { key: "entitlementUrl", label: "Entitlements CSV address", type: "url", help: addressHelp },
    { key: "accessGrantUrl", label: "Access CSV address", type: "url", help: addressHelp },
    { key: "applicationUrl", label: "Applications CSV address", type: "url", help: addressHelp },
    { key: "application", label: "Application name", type: "string", help: "Recorded on accounts and entitlements that have no application column" },
    {
      key: "columns",
      label: "Column names",
      type: "string",
      help: "Only for headers that differ from the field names, separated by ;  for example identity.email = Work Email; account.username = Login",
    },
  ],
  auth: {
    type: "bearer",
    token: "{secret.token}",
    fields: [{ key: "token", label: "Token for the addresses", help: "Sent as a Bearer token to the CSV addresses; leave empty when they need none", optional: true }],
  },
  application: "{settings.application}",
  receive: { file: { auth: "bearer" } },
  resources: {
    identity: fileResource("identityUrl", {
      externalId: text("externalid", "id", "employeeid", "employeenumber", "personid"),
      displayName: text("displayname", "name", "fullname"),
      firstName: text("firstname", "givenname"),
      lastName: text("lastname", "surname", "familyname"),
      email: lower("email", "workemail", "mail"),
      username: text("username", "login", "userid"),
      identityType: lower("identitytype", "type"),
      subtype: lower("subtype"),
      title: text("title", "jobtitle", "designation"),
      department: text("department"),
      businessUnit: text("businessunit"),
      location: text("location", "office"),
      employmentType: text("employmenttype"),
      organization: text("organization", "company"),
      managerExternalId: text("managerexternalid", "managerid", "manageremployeeid", "manager"),
      startDate: date("startdate", "hiredate", "dateofjoining"),
      endDate: date("enddate", "terminationdate", "relievingdate"),
      status: lower("status"),
    }),
    account: fileResource("accountUrl", {
      externalId: text("externalid", "id", "accountid"),
      application: text("application", "app", "system"),
      username: text("username", "login", "accountname"),
      email: lower("email", "mail"),
      displayName: text("displayname", "name"),
      owner: text("owner", "ownerexternalid", "identityexternalid", "employeeid"),
      status: lower("status"),
      accountType: lower("accounttype", "type"),
      // A map, not `boolean`: an empty or missing cell stays unknown rather than becoming false.
      privileged: { path: ["privileged", "admin"], transform: [{ map: { true: true, yes: true, y: true, "1": true, false: false, no: false, n: false, "0": false }, default: null }] },
      lastLoginAt: date("lastloginat", "lastlogin"),
      createdAt: date("createdat", "created"),
      expiresAt: date("expiresat", "expires"),
      entitlements: { path: ["entitlements", "groups", "roles"], transform: ["split"] },
    }),
    entitlement: fileResource("entitlementUrl", {
      externalId: text("externalid", "id", "entitlementid"),
      name: text("name", "entitlement", "displayname"),
      application: text("application", "app", "system"),
      type: lower("type", "entitlementtype"),
      description: text("description"),
      privilegeLevel: lower("privilegelevel", "privilege"),
      dataClassification: lower("dataclassification", "classification"),
    }),
    // A grant is identified by its account and entitlement, so a file needs no id column.
    access_grant: fileResource("accessGrantUrl", {
      externalId: { template: "{record.accountexternalid}:{record.entitlementexternalid}" },
      accountExternalId: text("accountexternalid"),
      entitlementExternalId: text("entitlementexternalid"),
      grantType: lower("granttype", "type"),
    }),
    application: fileResource("applicationUrl", {
      externalId: text("externalid", "id", "applicationid"),
      name: text("name", "application", "displayname"),
      category: text("category"),
      description: text("description"),
    }),
  },
};
