import { AuthShell } from "@/modules/ui";

// FOUNDATION (2026-09-26) — shown when the sign-in service cannot be
// reached. The request got no access (fail closed); this only tells the
// truth about why (CLAUDE.md §17.5) instead of claiming the session
// expired. The proxy rewrites to it with status 503, keeping the URL, so
// "Try again" reloads the page that was asked for.
export const metadata = { title: "Service unavailable" };

export default function ServiceUnavailablePage() {
  return (
    <AuthShell
      title="We can't reach the sign-in service"
      subtitle="Your session was not ended. WonderID could not confirm it just now, so nothing is shown until it can."
      footer={<>Nothing was changed while the service was unreachable.</>}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">This is usually brief. Try again in a moment.</p>
        {/* A plain link to the same URL: a full reload re-runs the check. */}
        <a href="" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
          Try again
        </a>
      </div>
    </AuthShell>
  );
}
