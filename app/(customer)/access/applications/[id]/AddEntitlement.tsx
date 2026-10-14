"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";

/**
 * An entitlement added by hand, for an application whose entitlements do not
 * come from a connector. Saved through POST
 * /api/v1/access/applications/:id/entitlements (access.manage); the server
 * classifies it like an imported one and its own message is shown.
 */

const field = "block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export function AddEntitlement({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [privilegeLevel, setPrivilegeLevel] = useState("standard");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await fetch(`/api/v1/access/applications/${applicationId}/entitlements`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: name.trim(), privilegeLevel }),
          });
          const json = await res.json().catch(() => ({}));
          const err = !res.ok || !json.ok ? (json.error?.message ?? "It could not be added") : null;
          setError(err);
          if (!err) setName("");
          router.refresh();
        });
      }}
    >
      <label className="min-w-48 flex-1">
        <span className="block text-xs text-muted-foreground">New entitlement</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={field} aria-label="New entitlement" />
      </label>
      <label className="w-32">
        <span className="block text-xs text-muted-foreground">Privilege</span>
        <select value={privilegeLevel} onChange={(e) => setPrivilegeLevel(e.target.value)} className={field} aria-label="New entitlement privilege">
          <option value="standard">Standard</option>
          <option value="elevated">Elevated</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Add entitlement
      </Button>
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
