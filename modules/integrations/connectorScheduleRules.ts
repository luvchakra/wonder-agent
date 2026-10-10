/**
 * Pure rules for scheduled connector syncs (connectorSchedules.ts does the
 * I/O): which connections are due, the window a run belongs to, and which
 * received files the retention purge removes.
 *
 * Vercel runs /api/cron/connector-syncs once a day on this plan. A daily
 * connection runs once per UTC day; an hourly one runs whenever no
 * scheduled job exists for the current UTC hour, which on a daily cron
 * means at every cron run. `hourly` is stored as the owner chose it, so it
 * takes effect as soon as the cron runs more often.
 */

export const CONNECTION_SCHEDULES = ["manual", "hourly", "daily"] as const;
export type ConnectionSchedule = (typeof CONNECTION_SCHEDULES)[number];

export function isConnectionSchedule(value: unknown): value is ConnectionSchedule {
  return typeof value === "string" && (CONNECTION_SCHEDULES as readonly string[]).includes(value);
}

/** The window `now` falls in: `d:YYYY-MM-DD` or `h:YYYY-MM-DDTHH` (UTC); null for manual. */
export function scheduleWindow(schedule: ConnectionSchedule, now: Date): string | null {
  const iso = now.toISOString();
  if (schedule === "daily") return `d:${iso.slice(0, 10)}`;
  if (schedule === "hourly") return `h:${iso.slice(0, 13)}`;
  return null;
}

/** When the window `now` falls in began. */
export function windowStart(schedule: ConnectionSchedule, now: Date): Date | null {
  if (schedule === "daily") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (schedule === "hourly") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  return null;
}

export type ScheduledConnection = { id: string; tenantId: string; schedule: string; status: string; driver: string | null };

/**
 * The connections to run now, each with its window: scheduled (not
 * manual), not disabled, reading something (a receive-only connector has
 * nothing to sync), and with no scheduled job yet in the current window.
 * `lastScheduled` maps a connection id to its newest scheduled job's
 * creation time. The unique (connection, window) index is the real
 * guarantee against a second run; this only avoids trying.
 */
export function dueConnections(
  connections: ScheduledConnection[],
  lastScheduled: Map<string, string>,
  now: Date,
): { connection: ScheduledConnection; window: string }[] {
  const out: { connection: ScheduledConnection; window: string }[] = [];
  for (const c of connections) {
    if (!isConnectionSchedule(c.schedule) || c.schedule === "manual") continue;
    if (c.status === "disabled" || !c.driver || c.driver === "none") continue;
    const start = windowStart(c.schedule, now)!;
    const last = lastScheduled.get(c.id);
    if (last && Date.parse(last) >= start.getTime()) continue;
    out.push({ connection: c, window: scheduleWindow(c.schedule, now)! });
  }
  return out;
}

/** How many received files each connection keeps after they are read. */
export const FILES_KEPT_PER_CONNECTION = 5;

/**
 * The files to purge: per connection, everything after its newest `keep`,
 * except a file no sync has read yet (it is waiting for its import). Rows
 * come newest first and carry their own tenant, which the delete repeats.
 */
export function filesToPurge(
  rows: { id: string; tenant_id: string; integration_id: string; received_at: string; consumed_at: string | null }[],
  keep = FILES_KEPT_PER_CONNECTION,
): { tenantId: string; integrationId: string; ids: string[] }[] {
  const seen = new Map<string, number>();
  const purge = new Map<string, { tenantId: string; integrationId: string; ids: string[] }>();
  const sorted = [...rows].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at));
  for (const r of sorted) {
    const n = (seen.get(r.integration_id) ?? 0) + 1;
    seen.set(r.integration_id, n);
    if (n <= keep || r.consumed_at === null) continue;
    const key = `${r.tenant_id}/${r.integration_id}`;
    const group = purge.get(key) ?? { tenantId: r.tenant_id, integrationId: r.integration_id, ids: [] };
    group.ids.push(r.id);
    purge.set(key, group);
  }
  return [...purge.values()];
}
