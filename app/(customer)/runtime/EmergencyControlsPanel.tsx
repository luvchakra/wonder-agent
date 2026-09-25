"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OctagonAlert } from "lucide-react";
import type { EmergencyControl } from "@/lib/shared/types/runtime";
import { engageEmergencyControlAction, liftEmergencyControlAction } from "@/app/actions/runtime";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmActionDialog, EmptyState } from "@/modules/ui";

/**
 * RUNTIME-P0-18 — emergency controls the Runtime Gateway honours. Every
 * action here needs runtime.emergency (the server actions check it),
 * a confirmation and a reason, and is audited. While the gateway is
 * observe-only, the controls change the recorded decision (e.g.
 * KILL_SWITCH) without blocking the agent. The card says so, rather than
 * implying a block that does not happen (§17.5).
 */

const LABEL: Record<EmergencyControl["controlType"], string> = {
  kill_switch: "Kill switch",
  tool_suspension: "Tool suspended",
  mcp_server_suspension: "MCP server suspended",
  session_termination: "Session terminated",
};

const TARGET_LABEL: Record<string, string> = {
  tool_suspension: "Tool name",
  mcp_server_suspension: "MCP server name",
  session_termination: "Session id",
};

export function EmergencyControlsPanel({ controls, canManage }: { controls: EmergencyControl[]; canManage: boolean }) {
  const router = useRouter();
  const active = controls.filter((c) => c.active);
  const killSwitch = active.find((c) => c.controlType === "kill_switch");
  const [type, setType] = useState("tool_suspension");
  const [target, setTarget] = useState("");

  const done = (r: { kind: string; success?: boolean }) => {
    if (r.kind === "single" && r.success) {
      setTarget("");
      router.refresh();
    }
  };

  return (
    <Card className={killSwitch ? "border-destructive/40 bg-destructive/[0.04]" : undefined}>
      <CardHeader
        title="Emergency controls"
        description="Kill switch, tool and MCP server suspension, and session termination. Observe-only: they change the gateway's recorded decision; nothing is blocked until enforcement is on."
        actions={
          canManage ? (
            killSwitch ? (
              <ConfirmActionDialog
                trigger={
                  <Button variant="outline" size="sm">
                    Release kill switch
                  </Button>
                }
                title="Release the kill switch"
                description="Agents' requests will be decided normally again."
                reasonRequired
                variant="default"
                confirmLabel="Release"
                onConfirm={async (reason) => ({ kind: "single", ...(await liftEmergencyControlAction(killSwitch.id, reason)) })}
                onDone={done}
              />
            ) : (
              <ConfirmActionDialog
                trigger={
                  <Button variant="destructive" size="sm">
                    <OctagonAlert className="size-4" aria-hidden="true" />
                    Engage kill switch
                  </Button>
                }
                title="Engage the kill switch"
                description="Every request from every agent in this organization will be decided DENY until the switch is released."
                reasonRequired
                confirmLabel="Engage kill switch"
                onConfirm={async (reason) => ({ kind: "single", ...(await engageEmergencyControlAction("kill_switch", null, reason)) })}
                onDone={done}
              />
            )
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {active.length === 0 ? (
          <EmptyState title="No emergency controls engaged" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {active.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
                <Badge tone="danger">{LABEL[c.controlType]}</Badge>
                {c.target ? <span className="font-mono text-xs text-foreground">{c.target}</span> : null}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {c.reason} · since {c.engagedAt.slice(0, 16).replace("T", " ")}
                </span>
                {canManage && c.controlType !== "kill_switch" ? (
                  <ConfirmActionDialog
                    trigger={
                      <Button variant="outline" size="sm">
                        Lift
                      </Button>
                    }
                    title={`Lift: ${LABEL[c.controlType]}${c.target ? ` (${c.target})` : ""}`}
                    description="Requests it covered will be decided normally again."
                    reasonRequired
                    variant="default"
                    confirmLabel="Lift control"
                    onConfirm={async (reason) => ({ kind: "single", ...(await liftEmergencyControlAction(c.id, reason)) })}
                    onDone={done}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label>
              <span className="block text-sm font-medium text-muted-foreground">Control</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="tool_suspension">Suspend a tool</option>
                <option value="mcp_server_suspension">Suspend an MCP server</option>
                <option value="session_termination">Terminate a session</option>
              </select>
            </label>
            <label className="min-w-[12rem] flex-1">
              <span className="block text-sm font-medium text-muted-foreground">{TARGET_LABEL[type]}</span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                maxLength={200}
                className="block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <ConfirmActionDialog
              trigger={
                <Button variant="secondary" disabled={!target.trim()}>
                  Engage
                </Button>
              }
              title="Engage emergency control"
              description={`${TARGET_LABEL[type]}: ${target.trim() || "—"}. Matching requests will be decided DENY until it is lifted.`}
              reasonRequired
              confirmLabel="Engage"
              onConfirm={async (reason) => ({ kind: "single", ...(await engageEmergencyControlAction(type, target, reason)) })}
              onDone={done}
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
