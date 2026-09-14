"use client";

import { useEffect } from "react";
import { ErrorState, Button } from "@/modules/ui";

/**
 * EXPERIENCE-P0-01.3 — a segment-level error boundary so an unhandled
 * error in any customer route renders a designed error state with a retry
 * action instead of Next.js's default unstyled error screen. Next.js
 * requires error boundaries to be Client Components.
 */
export default function CustomerSegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      description="An unexpected error occurred loading this page. Your data is unaffected."
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
