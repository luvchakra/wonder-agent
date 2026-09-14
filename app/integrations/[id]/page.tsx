import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIntegration, listMappings, listSyncJobs } from "@/modules/integrations/service";
import {
  createMappingAction,
  setCredentialAction,
  testConnectionAction,
  triggerSyncAction,
} from "@/app/actions/integrations";
import { ApiError } from "@/lib/shared/types/foundation";

const AUTH_TYPES = ["oauth2", "api_key", "basic", "bearer", "mtls"] as const;

// Bare functional detail screen — Experience Agent (Module 08) owns visual
// design; Platform Agent's future integration catalog UI may also compose
// this data differently. This page proves the data/actions work end to end.
export default async function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const integration = await getIntegration(ctx.tenantId!, id);
  if (!integration) notFound();

  const [jobs, mappings] = await Promise.all([listSyncJobs(ctx.tenantId!, id), listMappings(id)]);

  const setCredentialWithId = setCredentialAction.bind(null, id);
  const testConnectionWithId = testConnectionAction.bind(null, id);
  const triggerSyncWithId = triggerSyncAction.bind(null, id);
  const createMappingWithId = createMappingAction.bind(null, id);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/integrations">← All integrations</Link>
      </p>
      <h1>
        {integration.name} <small>({integration.status})</small>
      </h1>
      <p>
        Type: {integration.integrationTypeId} · Has credentials: {integration.hasCredentials ? "yes" : "no"} ·
        Last sync: {integration.lastSyncAt ?? "never"}
      </p>

      <section>
        <h2>Credential</h2>
        <form action={setCredentialWithId}>
          <select name="authType" defaultValue={AUTH_TYPES[3]}>
            {AUTH_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input name="secret" type="password" placeholder="secret / token" required />
          <button type="submit">Save credential</button>
        </form>
      </section>

      <section>
        <h2>Connection</h2>
        <form action={testConnectionWithId}>
          <button type="submit">Test connection</button>
        </form>
      </section>

      <section>
        <h2>Sync jobs</h2>
        <form action={triggerSyncWithId}>
          <button type="submit">Run sync now</button>
        </form>
        <ul>
          {jobs.map((j) => (
            <li key={j.id}>
              {j.createdAt}: {j.status} — processed {j.recordsProcessed}, failed {j.recordsFailed}
              {j.errors.length > 0 ? ` (${j.errors.length} error(s))` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Field mappings</h2>
        <ul>
          {mappings.map((m) => (
            <li key={m.id}>
              [{m.objectType}] {m.sourceField} → {m.targetField}
            </li>
          ))}
        </ul>
        <form action={createMappingWithId}>
          <select name="objectType">
            <option value="identity">identity</option>
            <option value="account">account</option>
            <option value="application">application</option>
            <option value="entitlement">entitlement</option>
            <option value="access_grant">access_grant</option>
          </select>
          <input name="sourceField" placeholder="source field (dot path)" required />
          <input name="targetField" placeholder="target field" required />
          <button type="submit">Add mapping</button>
        </form>
      </section>
    </main>
  );
}
