import type { PlatformAnnouncement } from "@/modules/platform-admin/service";

/**
 * PLATFORM-P0-05.4 — Experience Agent's half of Maintenance Mode &
 * Platform Announcements: Platform Agent owns the admin-side data model
 * and `getActiveAnnouncements()` (already published); this renders it.
 * Presentation only — no dismiss/mutation, since announcements are
 * platform-authored and time-windowed (`startsAt`/`endsAt`), not a
 * per-user preference to persist.
 */
export function AnnouncementsBanner({ announcements }: { announcements: PlatformAnnouncement[] }) {
  if (announcements.length === 0) return null;

  return (
    <div className="flex flex-col gap-px border-b border-border">
      {announcements.map((a) => (
        <div
          key={a.id}
          role="status"
          className={
            a.type === "maintenance"
              ? "bg-warning/10 px-4 py-2 text-sm text-warning sm:px-6"
              : "bg-info/10 px-4 py-2 text-sm text-info sm:px-6"
          }
        >
          <span className="font-medium">{a.title}</span>
          <span className="ml-2 text-foreground/80">{a.body}</span>
        </div>
      ))}
    </div>
  );
}
