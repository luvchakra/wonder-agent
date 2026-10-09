"use client";

import { useEffect } from "react";
import { WonderIDLogo } from "@/modules/ui";

/**
 * A full page load into the product once the first organization exists.
 * A client-side redirect would be served from the router cache, which still
 * holds the pre-organization "/ → /onboarding/start" redirect, and loop.
 */
export function EnterOrganization({ name }: { name: string }) {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <WonderIDLogo size={44} priority />
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
        Setting up {name}…
      </p>
    </div>
  );
}
