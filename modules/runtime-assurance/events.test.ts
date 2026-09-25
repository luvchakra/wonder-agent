// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeDedupeKey, inferEventType, isWithinReplayWindow, REPLAY_WINDOW_MAX_FUTURE_MS, REPLAY_WINDOW_MAX_PAST_MS } from "./events";
import type { RuntimeEventInput } from "@/lib/shared/types/runtime";

describe("computeDedupeKey — RUNTIME-P0-01.2", () => {
  const base: RuntimeEventInput = {
    agentId: "facebeef-0000-0000-0000-000000000001",
    eventTime: "2026-09-12T10:31:00Z",
    source: "mcp",
    tool: "query_customer",
    application: "snowflake",
    resource: "customer_db",
    action: "read",
    dataClassification: "PII",
    success: true,
  };

  it("is deterministic for the exact same event payload", () => {
    expect(computeDedupeKey(base)).toBe(computeDedupeKey({ ...base }));
  });

  it("differs when any comparison-relevant field differs", () => {
    const key = computeDedupeKey(base);
    expect(computeDedupeKey({ ...base, action: "write" })).not.toBe(key);
    expect(computeDedupeKey({ ...base, resource: "other_db" })).not.toBe(key);
    expect(computeDedupeKey({ ...base, eventTime: "2026-09-12T10:32:00Z" })).not.toBe(key);
    expect(computeDedupeKey({ ...base, agentId: "deadbeef-0000-0000-0000-000000000002" })).not.toBe(key);
  });

  it("does not collide across a shifted delimiter boundary", () => {
    const a = computeDedupeKey({ ...base, tool: "a", application: "" });
    const b = computeDedupeKey({ ...base, tool: "", application: "a" });
    expect(a).not.toBe(b);
  });
});

describe("isWithinReplayWindow — RUNTIME-P0-11", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");

  it("accepts an event timestamped at exactly now", () => {
    expect(isWithinReplayWindow(new Date(now).toISOString(), now)).toBe(true);
  });

  it("accepts an event just inside the future clock-skew allowance", () => {
    expect(isWithinReplayWindow(new Date(now + REPLAY_WINDOW_MAX_FUTURE_MS - 1).toISOString(), now)).toBe(true);
  });

  it("rejects an event beyond the future clock-skew allowance", () => {
    expect(isWithinReplayWindow(new Date(now + REPLAY_WINDOW_MAX_FUTURE_MS + 1000).toISOString(), now)).toBe(false);
  });

  it("accepts an event just inside the past replay window", () => {
    expect(isWithinReplayWindow(new Date(now - REPLAY_WINDOW_MAX_PAST_MS + 1).toISOString(), now)).toBe(true);
  });

  it("rejects an event older than the past replay window", () => {
    expect(isWithinReplayWindow(new Date(now - REPLAY_WINDOW_MAX_PAST_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("rejects an unparseable timestamp", () => {
    expect(isWithinReplayWindow("not-a-date", now)).toBe(false);
  });
});

describe("event types — RUNTIME-P0-16", () => {
  const base: RuntimeEventInput = {
    agentId: "facebeef-0000-0000-0000-000000000001",
    eventTime: "2026-09-25T10:00:00Z",
    source: "mcp",
    action: "read",
    success: true,
  };

  it("infers a type when a source sends none, as migration 0063 backfilled", () => {
    expect(inferEventType({ ...base, tool: "query" })).toBe("TOOL_EXECUTED");
    expect(inferEventType({ ...base, resource: "customer_db" })).toBe("DATA_ACCESS");
    expect(inferEventType({ ...base, dataClassification: "pii" })).toBe("DATA_ACCESS");
    expect(inferEventType(base)).toBe("API_CALL");
    expect(inferEventType({ ...base, tool: "query", eventType: "TOOL_REQUEST" })).toBe("TOOL_REQUEST");
  });

  it("keeps existing dedupe keys unchanged, and separates explicit types", () => {
    const legacy = computeDedupeKey(base);
    expect(computeDedupeKey({ ...base })).toBe(legacy);
    expect(computeDedupeKey({ ...base, eventType: "TOOL_REQUEST" })).not.toBe(computeDedupeKey({ ...base, eventType: "TOOL_EXECUTED" }));
    expect(computeDedupeKey({ ...base, eventType: "TOOL_REQUEST" })).not.toBe(legacy);
  });
});
