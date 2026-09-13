import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { signOutAction } from "@/app/actions/tenant";

// Placeholder shell only — the Experience Agent (Module 08) owns the actual
// customer-facing navigation/dashboard. See
// docs/plan/01-FOUNDATION-AGENT-BACKLOG.md FOUNDATION-P0-01.1.
export default async function Home() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    redirect("/onboarding");
  }

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>WonderAgent</h1>
      <p>
        Signed in as {user.email} — tenant <strong>{ctx.tenantSlug}</strong>, roles:{" "}
        {ctx.roles.join(", ") || "none"}.
      </p>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
