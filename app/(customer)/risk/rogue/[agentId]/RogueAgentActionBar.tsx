"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult, Button, LinkButton } from "@/modules/ui";

/**
 * EXPERIENCE-P0-13 — PRD §37's worked layout for Rogue Agent Detail names
 * six actions. Restrict/Suspend reuse the same lifecycle-transition
 * contract as `AgentPrimaryActionBar` (EXPERIENCE-P0-12); Assign owner
 * links to the Agent Overview tab's existing Owners card rather than
 * duplicating its assign-owner form here. "Create remediation" and "Mark
 * false positive" are per-finding (see `FindingActions.tsx`), not agent-
 * level, so they aren't in this bar.
 *
 * "Create exception" is intentionally disabled: Access Agent's
 * `createGovernanceException()` (modules/access-governance/policies.ts)
 * is a published service function but has no API route yet anywhere in
 * `/api/v1/policies/*` (verified by repo-wide search) — Experience Agent
 * does not add routes to another module's owned API prefix to make its
 * own story pass (CLAUDE.md non-negotiable #18). Recorded as a dependency
 * in the Experience Agent audit log rather than silently built around.
 */
export function RogueAgentActionBar({ agentId, agentName }: { agentId: string; agentName: string }) {
  const router = useRouter();

  async function transition(toState: string, reason: string): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/agents/${agentId}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toState, reason }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      return { kind: "single", success: false, error: body.error?.message ?? "Transition failed" };
    }
    return { kind: "single", success: true };
  }

  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmActionDialog
        trigger={
          <Button variant="outline" size="sm">
            Restrict agent
          </Button>
        }
        title="Restrict agent"
        description={`This transitions ${agentName} to RESTRICTED.`}
        reasonRequired
        confirmLabel="Restrict agent"
        onConfirm={(reason) => transition("RESTRICTED", reason)}
        onDone={(result) => result.kind === "single" && result.success && router.refresh()}
      />

      <ConfirmActionDialog
        trigger={
          <Button variant="destructive" size="sm">
            Suspend agent
          </Button>
        }
        title="Suspend agent"
        description={`This transitions ${agentName} to SUSPENDED.`}
        reasonRequired
        confirmLabel="Suspend agent"
        onConfirm={(reason) => transition("SUSPENDED", reason)}
        onDone={(result) => result.kind === "single" && result.success && router.refresh()}
      />

      <LinkButton href={`/agents/${agentId}#owners`} variant="outline" size="sm">
        Assign owner
      </LinkButton>

      <Button
        variant="outline"
        size="sm"
        disabled
        title="Blocked: Access Agent has not yet published an API route for creating a governance exception"
      >
        Create exception
      </Button>
    </div>
  );
}
