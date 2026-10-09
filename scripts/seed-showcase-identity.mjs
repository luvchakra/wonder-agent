#!/usr/bin/env node
/**
 * Adds the identity and administration side of the landing page's demo
 * organization (Northwind Financial, kept for product screenshots by the
 * user's 2026-09-17 decision): job titles for its people, more people,
 * external and machine identities, two groups, a custom role, a scoped
 * role assignment and an authorization policy — so the identity directory,
 * user, group, role and policy screens photograph like a real organization.
 *
 *   node scripts/seed-showcase-identity.mjs --tenant northwind-financial
 *
 * - Scoped to the ONE tenant named by slug; every row carries its id (§14).
 * - Idempotent: everything is found by a natural key first; existing values
 *   are never overwritten (only empty ones are filled).
 * - Uses the service-role key from .env.local (never printed). Run it only
 *   against an organization that holds demo data.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of (() => {
  try {
    return readFileSync(".env.local", "utf8").split("\n");
  } catch {
    return [];
  }
})()) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const slug = process.argv[process.argv.indexOf("--tenant") + 1];
if (!process.argv.includes("--tenant") || !slug) {
  console.error("usage: node scripts/seed-showcase-identity.mjs --tenant <slug>");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const counts = {};
const bump = (k) => (counts[k] = (counts[k] ?? 0) + 1);

const tenant = must(await db.from("tenants").select("id, name").eq("slug", slug).maybeSingle(), "tenant");
if (!tenant) throw new Error(`No organization with slug "${slug}"`);
const T = tenant.id;
console.log(`Seeding identity showcase for ${tenant.name}`);

// ------------------------------------------------------------ members
const members = must(
  await db.from("tenant_memberships").select("user_id, users(email, display_name)").eq("tenant_id", T).eq("status", "active"),
  "members",
);
const byEmail = Object.fromEntries(members.map((m) => [m.users.email, m.user_id]));
const admin = byEmail["ava.chen@northwind.example"];
if (!admin) throw new Error("The demo administrator ava.chen@northwind.example is not a member");

// Job titles for the people who sign in (only where empty).
const PROFILE = {
  "ava.chen@northwind.example": ["Head of Identity & Access", "Information Security", "London"],
  "marcus.webb@northwind.example": ["Financial Controller", "Finance Operations", "New York"],
  "priya.nair@northwind.example": ["AI Platform Lead", "Engineering", "Bengaluru"],
  "tom.alvarez@northwind.example": ["Security Analyst", "Information Security", "Austin"],
};
for (const [email, [title, department, location]] of Object.entries(PROFILE)) {
  const userId = byEmail[email];
  if (!userId) continue;
  const row = must(await db.from("identities").select("id, title").eq("tenant_id", T).eq("user_id", userId).eq("identity_type", "HUMAN").maybeSingle(), "identity");
  if (row && !row.title) {
    must(await db.from("identities").update({ title, department, location, employment_type: "Employee", source_system: "Workday" }).eq("tenant_id", T).eq("id", row.id), "profile");
    bump("profiles");
  }
}
const identityOf = async (userId) =>
  must(await db.from("identities").select("id").eq("tenant_id", T).eq("user_id", userId).eq("identity_type", "HUMAN").maybeSingle(), "identity")?.id ?? null;
const avaIdentity = await identityOf(admin);
const priyaIdentity = byEmail["priya.nair@northwind.example"] ? await identityOf(byEmail["priya.nair@northwind.example"]) : null;

// ------------------------------------------------- directory identities
async function ensureIdentity(row) {
  const found = must(
    await db.from("identities").select("id").eq("tenant_id", T).eq("identity_type", row.identity_type).eq("display_name", row.display_name).maybeSingle(),
    "find identity",
  );
  if (found) return found.id;
  const created = must(await db.from("identities").insert({ tenant_id: T, status: "active", ...row }).select("id").single(), `insert ${row.display_name}`);
  bump("identities");
  return created.id;
}
const PEOPLE = [
  ["Grace Okafor", "Chief Financial Officer", "Finance", "London", "Employee"],
  ["Daniel Kim", "Senior Accountant", "Finance Operations", "New York", "Employee"],
  ["Sofia Rossi", "Procurement Manager", "Procurement", "Milan", "Employee"],
  ["Liam O'Connor", "Data Engineer", "Engineering", "Dublin", "Employee"],
  ["Hannah Weber", "Customer Support Lead", "Customer Operations", "Berlin", "Employee"],
  ["Ravi Menon", "Platform Engineer", "Engineering", "Bengaluru", "Contractor"],
];
for (const [display_name, title, department, location, employment_type] of PEOPLE) {
  await ensureIdentity({
    identity_type: "HUMAN",
    display_name,
    email: `${display_name.toLowerCase().replace(/[^a-z]+/g, ".")}@northwind.example`,
    title,
    department,
    location,
    employment_type,
    source_system: "Workday",
    lifecycle_state: "ACTIVE",
    manager_identity_id: department.startsWith("Finance") ? null : avaIdentity,
  });
}
await ensureIdentity({
  identity_type: "HUMAN",
  display_name: "Oliver Grant",
  email: "oliver.grant@northwind.example",
  title: "Treasury Analyst",
  department: "Finance",
  location: "London",
  employment_type: "Employee",
  source_system: "Workday",
  lifecycle_state: "LEAVE_PENDING",
  end_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
});
for (const [display_name, organization, title] of [
  ["Elena Petrova", "Hale & Partners LLP", "External Auditor"],
  ["Kwame Mensah", "Ledgerline Consulting", "ERP Implementation Consultant"],
]) {
  await ensureIdentity({
    identity_type: "EXTERNAL",
    display_name,
    organization,
    title,
    external: true,
    source_system: "Partner portal",
    sponsor_identity_id: avaIdentity,
    end_date: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
  });
}
for (const [display_name, purpose, privileged] of [
  ["svc-snowflake-etl", "Nightly finance data loads into Snowflake", false],
  ["svc-sap-batch", "SAP period-close batch jobs", true],
  ["github-actions-deploy", "Production deployments from CI", true],
]) {
  await ensureIdentity({
    identity_type: "SERVICE_ACCOUNT",
    display_name,
    username: display_name,
    purpose,
    privileged,
    source_system: "Okta",
    owner_identity_id: priyaIdentity ?? avaIdentity,
  });
}

// -------------------------------------------------- roles and groups
const roleId = async (name) =>
  must(await db.from("roles").select("id").or(`tenant_id.is.null,tenant_id.eq.${T}`).eq("name", name).maybeSingle(), `role ${name}`)?.id;

// A custom role, built only from catalogued permissions.
let financeReviewer = await roleId("Finance Reviewer");
if (!financeReviewer) {
  financeReviewer = must(
    await db
      .from("roles")
      .insert({ tenant_id: T, name: "Finance Reviewer", display_name: "Finance Reviewer", description: "Reviews finance agents' findings, reports and certifications.", is_system: false, status: "active", created_by: admin })
      .select("id")
      .single(),
    "custom role",
  ).id;
  const perms = must(await db.from("permissions").select("id, key").in("key", ["agent.read", "finding.read", "report.read", "compliance.read", "access.read"]), "permissions");
  must(await db.from("role_permissions").insert(perms.map((p) => ({ role_id: financeReviewer, permission_id: p.id }))), "role permissions");
  bump("custom roles");
}

async function ensureGroup(name, description, memberEmails, roleIds) {
  let group = must(await db.from("groups").select("id").eq("tenant_id", T).eq("name", name).maybeSingle(), "group");
  if (!group) {
    group = must(await db.from("groups").insert({ tenant_id: T, name, description, created_by: admin }).select("id").single(), "insert group");
    bump("groups");
  }
  for (const email of memberEmails) {
    const userId = byEmail[email];
    if (!userId) continue;
    const { error } = await db.from("group_members").insert({ group_id: group.id, tenant_id: T, user_id: userId, added_by: admin });
    if (error && error.code !== "23505") throw new Error(`group member: ${error.message}`);
  }
  for (const id of roleIds) {
    const { error } = await db.from("group_roles").insert({ group_id: group.id, tenant_id: T, role_id: id, granted_by: admin });
    if (error && error.code !== "23505") throw new Error(`group role: ${error.message}`);
  }
}
await ensureGroup("Finance Operations", "Finance controllers and accountants who review finance agents.", ["marcus.webb@northwind.example"], [financeReviewer]);
await ensureGroup("Security Engineering", "Investigates findings and runs certification campaigns.", ["tom.alvarez@northwind.example"], [await roleId("SECURITY_ANALYST")]);

// A scoped, time-limited assignment: Priya administers production agents for 90 days, with MFA.
const priya = byEmail["priya.nair@northwind.example"];
const agentAdmin = await roleId("AGENT_ADMIN");
if (priya && agentAdmin) {
  const { error } = await db.from("user_roles").insert({
    tenant_id: T,
    user_id: priya,
    role_id: agentAdmin,
    granted_by: admin,
    scope_type: "environment",
    scope_values: ["production"],
    expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    requires_mfa: true,
  });
  if (error && error.code !== "23505") throw new Error(`scoped assignment: ${error.message}`);
  if (!error) bump("scoped assignments");
}

// An explicit policy: nobody but the Tenant Administrator deletes a production agent.
const policy = must(await db.from("authorization_policies").select("id").eq("tenant_id", T).eq("name", "Production agents are never deleted").maybeSingle(), "policy");
if (!policy) {
  must(
    await db.from("authorization_policies").insert({
      tenant_id: T,
      name: "Production agents are never deleted",
      description: "Retire, don't delete: deletion in production is reserved for the Tenant Administrator.",
      effect: "DENY",
      permissions: ["agent.delete"],
      scope_type: "environment",
      scope_values: ["production"],
      exempt_role_ids: [await roleId("TENANT_SUPER_ADMIN")],
      created_by: admin,
      updated_by: admin,
    }),
    "policy",
  );
  bump("policies");
}

console.log("Done:", counts);
