"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";
import { fieldInputClass } from "@/modules/ui/Field";

/**
 * Owner decision 2026-10-14 — the ID role new people from this source are
 * invited to WonderID with. Saved through PUT …/default-id-role, which
 * refuses the administrator role and any role whose permissions the saver
 * does not hold; its own message is shown.
 */
export function DefaultIdRoleForm({ sourceId, current, roles, disabled }: { sourceId: string; current: string | null; roles: { name: string; label: string }[]; disabled: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState(current ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await fetch(`/api/v1/integrations/identity-sources/${sourceId}/default-id-role`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: role || null }),
          });
          const json = await res.json().catch(() => ({}));
          setMessage(!res.ok || !json.ok ? { ok: false, text: json.error?.message ?? "It could not be saved" } : { ok: true, text: "Saved." });
          router.refresh();
        });
      }}
    >
      <label className="min-w-56 flex-1">
        <span className="mb-1 block text-sm font-medium text-muted-foreground">Default ID role for new people</span>
        <select value={role} onChange={(e) => setRole(e.target.value)} disabled={disabled} className={fieldInputClass} aria-label="Default ID role for new people">
          <option value="">None: don&apos;t give WonderID access</option>
          {roles.map((r) => (
            <option key={r.name} value={r.name}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" disabled={disabled || pending || role === (current ?? "")}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Save
      </Button>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={"w-full text-xs " + (message.ok ? "text-success" : "text-destructive")}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
