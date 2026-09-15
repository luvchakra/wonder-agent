import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

function getInitials(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const SIZES = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
} as const;

/**
 * EXPERIENCE — user avatar (initials-only; no stored avatar image in the
 * schema, so this is Fallback-only rather than wiring an unused Image).
 * `@radix-ui/react-avatar` was already a dependency before this component
 * existed.
 */
export function Avatar({
  name,
  email,
  size = "md",
  className,
}: {
  name?: string | null;
  email: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary/15 font-semibold text-primary",
        SIZES[size],
        className,
      )}
    >
      <AvatarPrimitive.Fallback delayMs={0}>{getInitials(name, email)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
