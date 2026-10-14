"use client";

import { useSyncExternalStore, useState } from "react";
import { Button } from "@/modules/ui";
import { clearInstallPrompt, heldInstallPrompt, installPromptVersion, isRunningInstalled, subscribeInstallPrompt } from "@/modules/ui/install/prompt";

/** The browser's install prompt when it offers one; otherwise where to find "Install app" in its menu. */
export function InstallNow() {
  useSyncExternalStore(subscribeInstallPrompt, installPromptVersion, () => 0);
  const [outcome, setOutcome] = useState<string | null>(null);
  const prompt = typeof window === "undefined" ? null : heldInstallPrompt();
  const installed = typeof window !== "undefined" && isRunningInstalled();

  if (installed) return <p className="text-sm text-foreground">You are using the installed app.</p>;
  if (outcome) return <p role="status" className="text-sm text-foreground">{outcome}</p>;
  if (prompt) {
    return (
      <Button
        onClick={async () => {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          clearInstallPrompt();
          setOutcome(choice.outcome === "accepted" ? "Installed. Open WonderID from your home screen or app list." : "Not installed. You can install it later from this page.");
        }}
      >
        Install WonderID
      </Button>
    );
  }
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>Use your browser&rsquo;s menu: &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;. If you installed WonderID earlier from an organization&rsquo;s address, remove that copy first.</p>
      <p>Switching organizations inside the app needs Chrome, Edge or Samsung Internet. On iPhone and in Firefox, each switch opens in the browser.</p>
    </div>
  );
}
