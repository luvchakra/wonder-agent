"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "./Button";

/**
 * A submit button for a plain server-action form (`<form action={…}>`)
 * that shows it is working while the action runs (CLAUDE.md §15: a user
 * must never wonder whether a click registered). Disabled while pending,
 * so a second click cannot start a second run.
 */
export function PendingSubmitButton({
  children,
  pendingLabel,
  variant = "default",
  size = "default",
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending || undefined}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
