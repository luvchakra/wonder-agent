import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listApplications } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { createApplicationAction } from "@/app/actions/access";

// Bare functional screen — Experience Agent (Module 08) owns visual design.
export default async function AccessPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const applications = await listApplications(ctx.tenantId!);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Applications</h1>
      <p>
        <Link href="/access/requests">View access requests →</Link>
      </p>
      <ul>
        {applications.map((a) => (
          <li key={a.id}>
            {a.name} {a.category ? `(${a.category})` : ""}
          </li>
        ))}
      </ul>
      <h2>Add an application</h2>
      <form action={createApplicationAction}>
        <input name="name" placeholder="Application name" required />
        <input name="category" placeholder="category (optional)" />
        <button type="submit">Add</button>
      </form>
      <p>
        <Link href="/agents">← AI Agents</Link>
      </p>
    </main>
  );
}
