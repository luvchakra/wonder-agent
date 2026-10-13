"use client";

import { useActionState } from "react";
import { renameTenantSlugAction, setTenantEnvironmentAction, type TenantSettingState } from "@/app/actions/platform";
import { Button, fieldInputClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

const ENVIRONMENTS = [
  ["production", "Production"],
  ["development", "Development"],
  ["test", "Test"],
  ["staging", "Staging"],
  ["sandbox", "Sandbox"],
] as const;

function Result({ state }: { state: TenantSettingState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("text-xs", state.ok ? "text-success" : "text-destructive")}>
      {state.message}
    </p>
  );
}

/** Owner request 2026-10-13: change the address prefix at any time. */
export function AddressForm({ tenantId, slug, base }: { tenantId: string; slug: string; base: string | null }) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>(renameTenantSlugAction.bind(null, tenantId), { ok: false, message: null });
  return (
    <form action={action} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input name="slug" aria-label="Address prefix" defaultValue={slug} required minLength={3} maxLength={40} className={cn(fieldInputClass, "w-56 font-mono")} />
        {base ? <span className="font-mono text-xs text-muted-foreground">.{base}</span> : null}
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Change address"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">The old address stops working at once; people sign in at the new one.</p>
      <Result state={state} />
    </form>
  );
}

/** Owner request 2026-10-13: change the environment chosen at the start. */
export function EnvironmentForm({ tenantId, environment }: { tenantId: string; environment: string }) {
  const [state, action, pending] = useActionState<TenantSettingState, FormData>(setTenantEnvironmentAction.bind(null, tenantId), { ok: false, message: null });
  return (
    <form action={action} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select name="environment" aria-label="Environment" defaultValue={environment} className={cn(fieldInputClass, "w-44")}>
          {ENVIRONMENTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
