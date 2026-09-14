import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrationTypes } from "@/modules/integrations/service";
import { createIntegrationAction } from "@/app/actions/integrations";
import { ApiError } from "@/lib/shared/types/foundation";

// Bare functional form — Experience Agent (Module 08) owns visual design.
export default async function NewIntegrationPage() {
  try {
    await requirePermission("integration.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const types = await listIntegrationTypes();

  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Add an integration</h1>
      <form action={createIntegrationAction}>
        <label>
          Type
          <select name="integrationTypeId" style={{ display: "block", width: "100%", marginBottom: 12 }}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name *
          <input name="name" required style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <label>
          Base URL
          <input name="baseUrl" placeholder="https://…" style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <button type="submit">Create</button>
      </form>
    </main>
  );
}
