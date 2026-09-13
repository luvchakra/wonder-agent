import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { createTenantAction, selectTenantAction } from "@/app/actions/tenant";

export default async function OnboardingPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const ctx = await getTenantContext();
  if (ctx.tenantId) {
    redirect("/");
  }

  const { data: memberships } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, tenants(name)")
    .eq("status", "active")
    .returns<{ tenant_id: string; tenants: { name: string } | null }[]>();

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>WonderAgent</h1>

      {memberships && memberships.length > 0 ? (
        <>
          <h2>Select an organization</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {memberships.map((m) => (
              <li key={m.tenant_id} style={{ marginBottom: 8 }}>
                <form action={selectTenantAction}>
                  <input type="hidden" name="tenantId" value={m.tenant_id} />
                  <button type="submit">{m.tenants?.name ?? m.tenant_id}</button>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>Create a new organization</h2>
      <form action={createTenantAction}>
        <label>
          Organization name
          <input name="name" required style={{ display: "block", width: "100%", marginBottom: 12 }} />
        </label>
        <button type="submit">Create organization</button>
      </form>
    </main>
  );
}
