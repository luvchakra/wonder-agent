// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eventRecords, mapRuntimeEvent, verifySender, MAX_EVENTS_PER_REQUEST } from "./receiveRules";
import { WONDERID_RUNTIME_EVENT_FIELDS } from "./definitions/runtime-event-fields";
import { validateDefinition } from "./validate";
import { runtimeGateway } from "./definitions/runtime-gateway";
import type { ConnectorDefinition, ReceiveSpec } from "./types";

const spec: NonNullable<ReceiveSpec["runtimeEvents"]> = { source: "rest", auth: "bearer", fields: WONDERID_RUNTIME_EVENT_FIELDS };
const event = { externalId: "e1", agentRef: "financebot", eventTime: "2026-10-10T10:00:00Z", action: "read", success: true, application: "Snowflake" };

describe("verifySender", () => {
  const body = '{"a":1}';
  it("accepts the connection secret as a bearer token, and nothing else", () => {
    expect(verifySender("bearer", "wr_secret", body, new Headers({ authorization: "Bearer wr_secret" }))).toBe(true);
    expect(verifySender("bearer", "wr_secret", body, new Headers({ authorization: "Bearer wr_other" }))).toBe(false);
    expect(verifySender("bearer", "wr_secret", body, new Headers())).toBe(false);
  });
  it("checks an HMAC-SHA256 of the exact raw body, in the named header", () => {
    const sig = createHmac("sha256", "k").update(body).digest("hex");
    expect(verifySender("hmac_sha256", "k", body, new Headers({ "x-webhook-signature": sig }), "x-webhook-signature")).toBe(true);
    expect(verifySender("hmac_sha256", "k", body, new Headers({ "x-wonderid-signature": `sha256=${sig}` }))).toBe(true);
    expect(verifySender("hmac_sha256", "k", '{"a":2}', new Headers({ "x-wonderid-signature": sig }))).toBe(false);
    expect(verifySender("hmac_sha256", "k", body, new Headers())).toBe(false);
  });
});

describe("runtime events received through a connection", () => {
  it("takes one event or a list, and refuses an oversized batch", () => {
    expect(eventRecords(spec, event)).toEqual([event]);
    expect(eventRecords(spec, [event, event])).toHaveLength(2);
    expect(eventRecords(spec, [])).toBe("no events");
    expect(eventRecords(spec, Array(MAX_EVENTS_PER_REQUEST + 1).fill(event))).toMatch(/at most/);
    expect(eventRecords({ ...spec, records: "events" }, { events: "x" })).toMatch(/must be a list/);
  });

  it("maps WonderID's event format, naming the agent by reference or id", () => {
    expect(mapRuntimeEvent(spec, event)).toMatchObject({ externalId: "e1", agentIdentityRef: "financebot", action: "read", success: true, application: "Snowflake", tool: null });
    expect(mapRuntimeEvent(spec, { ...event, agentRef: undefined, agentId: "6a4e…" })).toMatchObject({ agentIdentityRef: "6a4e…" });
  });

  it("refuses an event with a missing or malformed field, saying which", () => {
    expect(mapRuntimeEvent(spec, { ...event, eventTime: undefined })).toBe("eventTime: required");
    expect(mapRuntimeEvent(spec, { ...event, eventTime: "yesterday" })).toBe("eventTime: must be an ISO timestamp");
    expect(mapRuntimeEvent(spec, { ...event, success: "yes" })).toBe("success: must be true or false");
    expect(mapRuntimeEvent(spec, { ...event, tool: "x".repeat(201) })).toBe("tool: at most 200 characters");
    expect(mapRuntimeEvent(spec, { ...event, eventType: "made_up" })).toMatch(/^eventType: one of/);
    expect(mapRuntimeEvent(spec, "not an object")).toBe("each event must be a JSON object");
  });

  it("never lets a body choose the organization or the source: those fields are not mapped", () => {
    const mapped = mapRuntimeEvent(spec, { ...event, tenantId: "other-org", source: "gateway" });
    expect(mapped).not.toHaveProperty("tenantId");
    expect(mapped).not.toHaveProperty("source");
  });
});

describe("receive definitions", () => {
  it("a receive-only connector reads nothing and must receive something", () => {
    expect(validateDefinition(runtimeGateway).issues).toEqual([]);
    const silent: ConnectorDefinition = { ...runtimeGateway, receive: {} };
    expect(validateDefinition(silent).issues.map((i) => i.path)).toContain("receive");
    const reading = { ...runtimeGateway, resources: { account: { fields: { externalId: "id" } } } };
    expect(validateDefinition(reading).issues.map((i) => i.path)).toContain("resources");
  });

  it("checks the receiving side's fields, auth and secrets", () => {
    const bad = {
      ...runtimeGateway,
      receive: {
        runtimeEvents: { source: "gateway", auth: "basic", fields: { action: "a", colour: "c" } },
        webhook: { auth: "bearer", signatureHeader: "not a header!" },
        gateway: { authorize: "yes" },
      },
    };
    const paths = validateDefinition(bad).issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "receive.runtimeEvents.source",
        "receive.runtimeEvents.auth",
        "receive.runtimeEvents.fields.colour",
        "receive.runtimeEvents.fields.eventTime",
        "receive.webhook.signatureHeader",
        "receive.gateway",
      ]),
    );
    const leaky = { ...runtimeGateway, receive: { webhook: { auth: "bearer", externalId: "{secret.x}" } } };
    expect(validateDefinition(leaky).issues.some((i) => i.message.includes("auth block"))).toBe(true);
  });
});
