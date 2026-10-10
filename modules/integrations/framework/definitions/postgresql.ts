import type { ConnectorDefinition } from "../types";

/** PostgreSQL: login roles, group roles with the table privileges they carry, and role membership, from the system catalog. */
export const postgresql: ConnectorDefinition = {
  schemaVersion: 1,
  key: "postgresql",
  version: "1.0.0",
  name: "PostgreSQL",
  vendor: "PostgreSQL",
  category: "database",
  description:
    "Database logins (superusers and other powerful attributes flagged, expiry dates), group roles with the table privileges each carries, and which login holds which role. Reads only the system catalog, which every login can read, over verified TLS.",
  documentationUrl: "https://www.postgresql.org/docs/current/catalogs.html",
  driver: "sql",
  settings: [
    { key: "url", label: "Database address", type: "url", required: true, help: "postgres://host:5432/database" },
    { key: "caCertificate", label: "CA certificate (PEM)", type: "string", help: "Only if the server's certificate is signed by a private CA" },
  ],
  auth: {
    type: "sql_password",
    username: "{secret.username}",
    password: "{secret.password}",
    fields: [
      { key: "username", label: "Login", help: "A login with no privileges of its own: the catalog is readable by every login" },
      { key: "password", label: "Password" },
    ],
  },
  test: { query: "SELECT current_user" },
  application: "PostgreSQL",
  resources: {
    account: {
      query: `SELECT r.rolname,
  (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication) AS privileged,
  CASE WHEN r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil < now() THEN 'expired' ELSE 'active' END AS status,
  CASE WHEN r.rolvaliduntil = 'infinity' THEN NULL ELSE r.rolvaliduntil END AS valid_until,
  shobj_description(r.oid, 'pg_authid') AS comment
FROM pg_roles r
WHERE r.rolcanlogin AND r.rolname !~ '^pg_'
ORDER BY r.rolname`,
      fields: {
        externalId: "rolname",
        username: "rolname",
        displayName: { path: "comment", default: null },
        status: "status",
        privileged: "privileged",
        expiresAt: { path: "valid_until", transform: ["date"] },
      },
    },
    entitlement: {
      query: `SELECT r.rolname,
  shobj_description(r.oid, 'pg_authid') AS comment,
  (SELECT string_agg(p.privileges || ' on ' || p.relation, ' | ' ORDER BY p.relation)
     FROM (SELECT n.nspname || '.' || c.relname AS relation, string_agg(DISTINCT a.privilege_type, ', ') AS privileges
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
            WHERE a.grantee = r.oid AND c.relkind IN ('r', 'v', 'm', 'p')
            GROUP BY 1) p) AS privileges,
  r.rolcreaterole OR r.rolsuper OR EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
     WHERE a.grantee = r.oid AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) AS writes
FROM pg_roles r
WHERE NOT r.rolcanlogin AND (r.rolname !~ '^pg_' OR r.oid IN (SELECT roleid FROM pg_auth_members))
ORDER BY r.rolname`,
      fields: {
        externalId: "rolname",
        name: "rolname",
        type: { value: "role" },
        description: { path: "privileges", default: null },
        privilegeLevel: { path: "writes", transform: [{ map: { true: "elevated", false: "standard" } }] },
      },
    },
    access_grant: {
      query: `SELECT m.rolname AS member, r.rolname AS role
FROM pg_auth_members a
JOIN pg_roles r ON r.oid = a.roleid
JOIN pg_roles m ON m.oid = a.member
WHERE m.rolcanlogin
ORDER BY 1, 2`,
      fields: {
        externalId: { template: "{record.member}:{record.role}" },
        accountExternalId: "member",
        entitlementExternalId: "role",
        grantType: { value: "direct" },
      },
    },
  },
};
