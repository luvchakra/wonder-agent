// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dueConnections, filesToPurge, isConnectionSchedule, scheduleWindow, windowStart, type ScheduledConnection } from "./connectorScheduleRules";

const now = new Date("2026-10-10T20:45:00Z");
const conn = (id: string, schedule: string, patch: Partial<ScheduledConnection> = {}): ScheduledConnection => ({ id, tenantId: "t1", schedule, status: "connected", driver: "file", ...patch });

describe("connection schedules", () => {
  it("are manual, hourly or daily", () => {
    expect(["manual", "hourly", "daily"].every(isConnectionSchedule)).toBe(true);
    expect(isConnectionSchedule("weekly")).toBe(false);
  });

  it("name the UTC window a run belongs to", () => {
    expect(scheduleWindow("daily", now)).toBe("d:2026-10-10");
    expect(scheduleWindow("hourly", now)).toBe("h:2026-10-10T20");
    expect(scheduleWindow("manual", now)).toBeNull();
    expect(windowStart("daily", now)?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(windowStart("hourly", now)?.toISOString()).toBe("2026-10-10T20:00:00.000Z");
  });

  it("run a connection once per window", () => {
    const connections = [conn("daily-new", "daily"), conn("daily-done", "daily"), conn("daily-yesterday", "daily"), conn("hourly-done", "hourly"), conn("hourly-earlier", "hourly")];
    const last = new Map([
      ["daily-done", "2026-10-10T00:05:00Z"],
      ["daily-yesterday", "2026-10-09T20:45:00Z"],
      ["hourly-done", "2026-10-10T20:01:00Z"],
      ["hourly-earlier", "2026-10-10T19:59:00Z"],
    ]);
    expect(dueConnections(connections, last, now).map((d) => `${d.connection.id} ${d.window}`)).toEqual([
      "daily-new d:2026-10-10",
      "daily-yesterday d:2026-10-10",
      "hourly-earlier h:2026-10-10T20",
    ]);
  });

  it("skip manual, disabled, receive-only and unreadable connections", () => {
    const connections = [conn("m", "manual"), conn("off", "daily", { status: "disabled" }), conn("none", "daily", { driver: "none" }), conn("broken", "daily", { driver: null }), conn("odd", "weekly"), conn("http", "daily", { driver: "http" })];
    expect(dueConnections(connections, new Map(), now).map((d) => d.connection.id)).toEqual(["http"]);
  });
});

describe("received-file retention", () => {
  const row = (id: string, integration: string, day: number, read = true, tenant = "t1") => ({
    id,
    tenant_id: tenant,
    integration_id: integration,
    received_at: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`,
    consumed_at: read ? "2026-10-10T00:00:00Z" : null,
  });

  it("keeps each connection's newest five and every unread file", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => row(`a${d}`, "A", d, d !== 2)).concat([row("b1", "B", 1, true, "t2"), row("b2", "B", 2, true, "t2")]);
    expect(filesToPurge(rows)).toEqual([{ tenantId: "t1", integrationId: "A", ids: ["a3", "a1"] }]);
  });

  it("purges per connection and tenant, never mixing them", () => {
    const rows = [1, 2].map((d) => row(`a${d}`, "A", d)).concat([1, 2].map((d) => row(`b${d}`, "B", d, true, "t2")));
    expect(filesToPurge(rows, 1)).toEqual([
      { tenantId: "t1", integrationId: "A", ids: ["a1"] },
      { tenantId: "t2", integrationId: "B", ids: ["b1"] },
    ]);
  });
});
