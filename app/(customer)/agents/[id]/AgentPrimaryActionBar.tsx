"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConfirmActionDialog, type ConfirmActionResult, Button, LinkButton } from "@/modules/ui";

/**
 * EXPERIENCE-P0-12 — PRD §35's worked layout primary action bar: Certify
 * Access, Restrict, Suspend, Request Change, Investigate, View Access
 * Graph. Restrict/Suspend reuse the existing lifecycle-transition contract
 * (`POST /api/v1/agents/:id/lifecycle`, same one the Lifecycle card's form
 * already calls) behind `ConfirmActionDialog` per CLAUDE.md §13 — no new
 * business logic, only a second, more prominent entry point to the same
 * capability with a real confirmation (non-negotiable #15). Certify
 * Access/Request Change/Investigate/View Access Graph are navigation to
 * existing screens where those actions actually happen (there is no
 * single-agent "certify now" or "request change" action distinct from
 * launching a certification campaign or creating a new contract version —
 * see the Experience Agent audit log).
 */
export function AgentPrimaryActionBar({ agentId, agentName }: { agentId: string; agentName: string }) {
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
      <LinkButton href="/compliance/campaigns" variant="outline" size="sm">
        Certify Access
      </LinkButton>

      <ConfirmActionDialog
        trigger={
          <Button variant="outline" size="sm">
            Restrict
          </Button>
        }
        title="Restrict agent"
        description={`This transitions ${agentName} to RESTRICTED — a governance-imposed limitation on its access/activity.`}
        reasonRequired
        confirmLabel="Restrict agent"
        onConfirm={(reason) => transition("RESTRICTED", reason)}
        onDone={(result) => result.kind === "single" && result.success && router.refresh()}
      />

      <ConfirmActionDialog
        trigger={
          <Button variant="destructive" size="sm">
            Suspend
          </Button>
        }
        title="Suspend agent"
        description={`This transitions ${agentName} to SUSPENDED, halting its approved activity until reinstated.`}
        reasonRequired
        confirmLabel="Suspend agent"
        onConfirm={(reason) => transition("SUSPENDED", reason)}
        onDone={(result) => result.kind === "single" && result.success && router.refresh()}
      />

      <Link href="#contract" className="inline-flex">
        <Button variant="outline" size="sm">
          Request Change
        </Button>
      </Link>

      <LinkButton href={`/risk/agents/${agentId}`} variant="outline" size="sm">
        Investigate
      </LinkButton>

      <LinkButton href={`/access/agents/${agentId}`} variant="outline" size="sm">
        View Access Graph
      </LinkButton>
    </div>
  );
}
