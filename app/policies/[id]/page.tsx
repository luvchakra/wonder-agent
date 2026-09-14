import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getPolicy, listPolicyExceptions, listPolicyRules } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { addPolicyRuleAction } from "@/app/actions/access";

const RULE_TYPES = ["rbac", "abac", "resource", "time"] as const;

// Bare functional screen — Experience Agent (Module 08) owns visual design.
export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const policy = await getPolicy(id);
  if (!policy) notFound();

  const [rules, exceptions] = await Promise.all([listPolicyRules(id), listPolicyExceptions(id)]);
  const addRuleWithId = addPolicyRuleAction.bind(null, id);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <p>
        <Link href="/policies">← All policies</Link>
      </p>
      <h1>
        {policy.name} <small>({policy.status})</small>
      </h1>
      <p>
        Category: {policy.policyCategory} · Severity: {policy.severity} · Action: {policy.action}
      </p>

      <h2>Rules</h2>
      <ul>
        {rules.map((r) => (
          <li key={r.id}>
            [{r.ruleType}] <code>{JSON.stringify(r.condition)}</code>
          </li>
        ))}
      </ul>
      <form action={addRuleWithId}>
        <select name="ruleType">
          {RULE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          name="condition"
          placeholder='{"field":"agent.criticality","op":"eq","value":"high"}'
          style={{ width: "60%" }}
          required
        />
        <button type="submit">Add rule</button>
      </form>

      <h2>Exceptions</h2>
      <ul>
        {exceptions.map((e) => (
          <li key={e.id}>
            {e.reason} {e.agentId ? `(agent ${e.agentId})` : "(tenant-wide)"}
            {e.expiresAt ? ` — expires ${e.expiresAt}` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
