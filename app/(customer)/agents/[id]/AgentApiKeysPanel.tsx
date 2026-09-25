"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import type { AgentApiKey } from "@/lib/shared/types/foundation";
import { createAgentApiKeyAction, revokeAgentApiKeyAction, type CreateAgentKeyState } from "@/app/actions/agentApiKeys";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmActionDialog, EmptyState } from "@/modules/ui";

/**
 * FOUNDATION-P0-17 — the agent's Runtime Gateway credentials. A new key is
 * displayed exactly once, straight from the create action's result; it is
 * never stored, so there is nothing to show again after a refresh. The list
 * shows only the non-secret prefix. Controls are hidden when the user lacks
 * the permission, but the server actions enforce it regardless.
 */

const STATUS_TONE = { active: "success", revoked: "neutral", expired: "warning" } as const;

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}

function NewKeyNotice({ secret, name }: { secret: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded-lg border border-warning/40 bg-warning/[0.08] p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
        Copy the key for “{name}” now. It will not be shown again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground">
          {secret}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy key"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The agent sends it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code> to the Runtime Gateway.
      </p>
    </div>
  );
}

export function AgentApiKeysPanel({
  agentId,
  keys,
  canCreate,
  canRevoke,
}: {
  agentId: string;
  keys: AgentApiKey[];
  canCreate: boolean;
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<CreateAgentKeyState, FormData>(
    createAgentApiKeyAction.bind(null, agentId),
    { status: "idle" },
  );

  return (
    <Card>
      <CardHeader
        title="API keys"
        description="Credentials this agent presents to the Runtime Gateway. Each key is bound to this agent and this organization."
      />
      <CardBody className="space-y-4">
        {state.status === "created" ? <NewKeyNotice secret={state.secret} name={state.name} /> : null}
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        {keys.length === 0 ? (
          <EmptyState title="No API keys" description="Create one when this agent is ready to call the Runtime Gateway." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{k.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{k.keyPrefix}…</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  Created {fmt(k.createdAt)} · Last used {fmt(k.lastUsedAt)}
                  {k.expiresAt ? ` · Expires ${fmt(k.expiresAt)}` : ""}
                </span>
                <Badge tone={STATUS_TONE[k.status]}>{k.status === "active" ? "Active" : k.status === "revoked" ? "Revoked" : "Expired"}</Badge>
                {canRevoke && k.status === "active" ? (
                  <ConfirmActionDialog
                    trigger={
                      <Button variant="outline" size="sm">
                        Revoke
                      </Button>
                    }
                    title={`Revoke “${k.name}”`}
                    description="The agent is refused the next time it presents this key. This cannot be undone; create a new key to restore access."
                    reasonRequired
                    confirmLabel="Revoke key"
                    onConfirm={async (reason) => {
                      const result = await revokeAgentApiKeyAction(agentId, k.id, reason);
                      return { kind: "single", success: result.success, error: result.error };
                    }}
                    onDone={(result) => result.kind === "single" && result.success && router.refresh()}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canCreate ? (
          <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="min-w-[12rem] flex-1">
              <span className="block text-sm font-medium text-muted-foreground">Key name</span>
              <input
                name="name"
                required
                maxLength={80}
                placeholder="e.g. production gateway"
                className="block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              />
            </label>
            <label>
              <span className="block text-sm font-medium text-muted-foreground">Expires on (optional)</span>
              <input
                name="expiresOn"
                type="date"
                className="block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {pending ? "Creating…" : "Create API key"}
            </Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
