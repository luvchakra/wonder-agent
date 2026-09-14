import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * EXPERIENCE-P0-09 (shadcn/CVA technology foundation). Standard shadcn
 * `cn()` helper — merges conditional class lists via clsx, then resolves
 * conflicting Tailwind utility classes (e.g. two different `px-*` values)
 * via tailwind-merge so the last one wins predictably.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
