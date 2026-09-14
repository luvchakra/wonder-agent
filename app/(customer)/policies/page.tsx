import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listPolicies } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { createPolicyAction } from "@/app/actions/access";

const CATEGORIES = ["identity", "access", "runtime", "agent", "lifecycle"] as const;
const ACTIONS = ["flag", "restrict", "block"] as const;

// Bare functional screen — Experience Agent (Module 08) owns visual design.
export default async function PoliciesPage() {
  let ctx;
  try {
    ctx = await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const policies = await listPolicies(ctx.tenantId!);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Policies</h1>
      <ul>
        {policies.map((p) => (
          <li key={p.id}>
            <Link href={`/policies/${p.id}`}>
              {p.name} [{p.policyCategory}] — {p.severity}/{p.action} — {p.status}
            </Link>
          </li>
        ))}
      </ul>
      <h2>Create a policy</h2>
      <form action={createPolicyAction}>
        <input name="name" placeholder="Policy name" required />
        <select name="policyCategory">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="action">
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button type="submit">Create</button>
      </form>
    </main>
  );
}
