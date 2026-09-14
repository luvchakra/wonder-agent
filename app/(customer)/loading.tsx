import { DetailSkeleton } from "@/modules/ui";

/**
 * EXPERIENCE-P0-01.3 — a segment-level fallback so every route under the
 * customer shell shows a real skeleton (never a blank white screen) during
 * its async data fetch, per CLAUDE.md §15's 300ms rule. Individual pages
 * may still render a more specific skeleton shape via their own
 * <Suspense> boundary; this is the systemic floor every route gets for
 * free from Next.js App Router's file-based loading convention.
 */
export default function CustomerSegmentLoading() {
  return <DetailSkeleton />;
}
