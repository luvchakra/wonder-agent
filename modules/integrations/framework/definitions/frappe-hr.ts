import type { ConnectorDefinition } from "../types";

/** Frappe HR (HRMS): the HR system of record. People, managers, departments, joiners and leavers. */
export const frappeHr: ConnectorDefinition = {
  schemaVersion: 1,
  key: "frappe-hr",
  version: "1.0.0",
  name: "Frappe HR",
  vendor: "Frappe",
  category: "hr",
  description: "Employees from Frappe HR (HRMS): names, work email, title, department, location, manager, employment type, joining and relieving dates, and status. Use as an authoritative identity source.",
  documentationUrl: "https://docs.frappe.io/framework/user/en/api/rest",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Frappe HR address", type: "url", required: true, help: "For example https://hr.example.com" }],
  auth: {
    type: "header",
    name: "Authorization",
    value: "token {secret.apiKey}:{secret.apiSecret}",
    fields: [
      { key: "apiKey", label: "API key", help: "From a user with read access to Employee (User → API Access → Generate keys)" },
      { key: "apiSecret", label: "API secret" },
    ],
  },
  test: { request: { path: "/api/method/frappe.auth.get_logged_user" } },
  rateLimitPerSecond: 10,
  resources: {
    identity: {
      request: {
        path: "/api/resource/Employee",
        query: {
          fields: '["name","employee_name","first_name","last_name","company_email","prefered_email","user_id","designation","department","branch","company","employment_type","reports_to","date_of_joining","relieving_date","contract_end_date","status"]',
          order_by: "name asc",
        },
      },
      records: "data",
      pagination: { type: "offset", param: "limit_start", sizeParam: "limit_page_length", size: 500 },
      fields: {
        externalId: "name",
        displayName: "employee_name",
        firstName: "first_name",
        lastName: "last_name",
        email: { path: "company_email", transform: ["lower"] },
        username: "user_id",
        title: "designation",
        department: "department",
        location: "branch",
        organization: "company",
        employmentType: "employment_type",
        managerExternalId: "reports_to",
        startDate: { path: "date_of_joining", transform: ["date"] },
        endDate: { path: "relieving_date", transform: ["date"] },
        status: { path: "status", transform: [{ map: { Active: "active", Inactive: "inactive", Suspended: "suspended", Left: "terminated" }, default: "active" }] },
        identityType: { value: "HUMAN" },
      },
    },
  },
};
