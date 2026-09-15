import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * EXPERIENCE-P0-09 (UX-P0-18), UX-P0-06 (12_ADVANCED_PRODUCT_UX_
 * REQUIREMENTS.md §9). The shadcn/CVA button variant set exactly:
 * default/outline/secondary/ghost/destructive/link — no other variant
 * names. `default` is the primary/CTA action; destructive actions use
 * `destructive` and should generally be visually separated from a nearby
 * primary action (UX-P0-24 / EXPERIENCE-P0-04). Sizes are the doc's exact
 * heights (sm: h-8, default: h-9, lg: h-10) plus a square `icon` size for
 * icon-only buttons (e.g. table-row `...` menus).
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-10 px-4",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

export function Button({
  variant,
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
}: { href: string; children: React.ReactNode } & ButtonVariants & { className?: string }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </Link>
  );
}
