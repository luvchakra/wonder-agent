"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { discoverMcpAction, type DiscoverMcpState } from "@/app/actions/integrations";
import { Button } from "@/modules/ui";

/** Re-reads one MCP server's declarations; shows the real result, never an optimistic one. */
export function DiscoverMcpButton({ integrationId, name }: { integrationId: string; name: string }) {
  const [state, action, pending] = useActionState<DiscoverMcpState, FormData>(discoverMcpAction.bind(null, integrationId), { status: "idle" });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Discover ${name} now`}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
        {pending ? "Discovering…" : "Discover now"}
      </Button>
      <span role="status" className="text-xs">
        {state.status === "done" ? (
          <span className="text-muted-foreground">
            Found {state.tools} tool{state.tools === 1 ? "" : "s"} and {state.resources} resource{state.resources === 1 ? "" : "s"}.
          </span>
        ) : state.status === "error" ? (
          <span className="text-destructive">Discovery failed: {state.message}</span>
        ) : null}
      </span>
    </form>
  );
}
