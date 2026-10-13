"use client";

import { useActionState, useEffect, useState } from "react";
import { setUpOrganizationAction, type SetUpOrganizationState } from "@/app/actions/tenant";
import { ENVIRONMENT_LABEL, ORGANIZATION_ENVIRONMENTS, PREFIX_MAX, environmentSlug, slugify, type OrganizationEnvironment } from "@/lib/tenant/organizationName";
import { Button, environmentColor, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

/**
 * Owner request (2026-10-13): the "Create a new organization" card on
 * /onboarding also asks for the address prefix and the environment. The
 * prefix follows the name until the person edits it; the address preview
 * follows both: `<prefix>.<base>` for production, `<prefix>-dev.<base>` and
 * so on.
 */
export function OrganizationSetupForm({ base }: { base: string | null }) {
  const [state, action, pending] = useActionState<SetUpOrganizationState, FormData>(setUpOrganizationAction, { ok: false, error: null });
  const [name, setName] = useState("");
  const [prefixEdited, setPrefixEdited] = useState(false);
  const [typedPrefix, setPrefix] = useState("");
  const prefix = prefixEdited ? typedPrefix : slugify(name).slice(0, PREFIX_MAX).replace(/-+$/, "");
  const [environment, setEnvironment] = useState<OrganizationEnvironment>("production");

  // A full page load once it exists: the router cache still holds the pre-organization redirect.
  useEffect(() => {
    if (state.ok) window.location.replace("/");
  }, [state.ok]);

  if (state.ok) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
        Setting up {state.name}…
      </p>
    );
  }

  const address = `${environmentSlug(prefix || "…", environment)}${base ? `.${base}` : ""}`;
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="org-name" className={fieldLabelClass}>
          Organization name
        </label>
        <input id="org-name" name="name" required minLength={2} maxLength={80} placeholder="Acme Corp" value={name} onChange={(e) => setName(e.target.value)} className={fieldInputClass} />
      </div>
      <div>
        <label htmlFor="org-prefix" className={fieldLabelClass}>
          Address prefix
        </label>
        <input
          id="org-prefix"
          name="prefix"
          required
          minLength={3}
          maxLength={PREFIX_MAX}
          pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
          value={prefix}
          placeholder="acme"
          onChange={(e) => {
            setPrefixEdited(true);
            setPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
          }}
          className={cn(fieldInputClass, "font-mono")}
          aria-describedby="org-address"
        />
        <p id="org-address" className="mt-1 truncate font-mono text-xs text-muted-foreground">
          https://{address}
        </p>
      </div>
      <fieldset>
        <legend className={fieldLabelClass}>Environment</legend>
        <div className="grid grid-cols-2 gap-2">
          {ORGANIZATION_ENVIRONMENTS.map((env) => (
            <label
              key={env}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                environment === env ? environmentColor(env).badge : "border-border hover:bg-accent",
              )}
            >
              <input type="radio" name="environment" value={env} checked={environment === env} onChange={() => setEnvironment(env)} className="sr-only" />
              <span aria-hidden className={cn("size-2 rounded-full", environmentColor(env).dot)} />
              {ENVIRONMENT_LABEL[env]}
            </label>
          ))}
        </div>
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
