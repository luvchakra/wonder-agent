import { createHmac, timingSafeEqual } from "node:crypto";
import { RUNTIME_EVENT_TYPES, type RuntimeEventType } from "@/lib/shared/types/runtime";
import { mapField, readPath } from "./mapping";
import { fileAddress } from "./drivers/file";
import { RESOURCE_KINDS, type ConnectorDefinition, type ReceiveSpec, type ResourceKind, type ResourceSpec } from "./types";

/**
 * The resource a received file is for, from its `x-wonderid-kind` header:
 * one the definition reads from received files (a kind the connection
 * fetches from an address does not also take uploads, which would be
 * silently ignored).
 */
export function uploadTarget(
  def: ConnectorDefinition,
  settings: Record<string, unknown>,
  kindHeader: string | null,
): { kind: ResourceKind; spec: ResourceSpec } | { status: number; message: string } {
  if (def.driver !== "file" || !def.receive?.file) return { status: 404, message: "This connection does not receive files" };
  const kind = (kindHeader ?? "").trim().toLowerCase();
  const kinds = RESOURCE_KINDS.filter((k) => def.resources[k] && !Array.isArray(def.resources[k]));
  if (!(kinds as readonly string[]).includes(kind)) return { status: 400, message: `x-wonderid-kind: one of ${kinds.join(", ")}` };
  const spec = def.resources[kind as ResourceKind] as ResourceSpec;
  if (fileAddress(spec, settings)) return { status: 409, message: `This connection reads ${kind} from an address, not from received files` };
  return { kind: kind as ResourceKind, spec };
}

/** A sender's file name, kept for the record only: printable, at most 200 characters. */
export function uploadFilename(header: string | null): string | null {
  const name = [...(header ?? "")].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join("").trim();
  return name ? name.slice(0, 200) : null;
}

/**
 * Pure rules for the receiving side (receive.ts does the I/O): checking a
 * sender's credential, and turning a received body into runtime events.
 * Everything a sender sends is data (§17.2); nothing in it can choose the
 * organization, the connection or the event's source.
 */

export const MAX_EVENTS_PER_REQUEST = 500;
const MAX_FIELD = 200;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** A received request's credential: the connection's secret as a bearer token, or an HMAC-SHA256 (hex) of the raw body. */
export function verifySender(
  mode: "bearer" | "hmac_sha256",
  secret: string,
  rawBody: string,
  headers: Headers,
  signatureHeader = "x-wonderid-signature",
): boolean {
  if (mode === "bearer") {
    const auth = headers.get("authorization") ?? "";
    return auth.startsWith("Bearer ") && safeEqual(auth.slice(7).trim(), secret);
  }
  const presented = (headers.get(signatureHeader) ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
  if (!presented) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqual(expected, presented);
}

export type ReceivedRuntimeEvent = {
  externalId: string | null;
  agentIdentityRef: string | null;
  eventTime: string;
  action: string;
  success: boolean;
  tool: string | null;
  application: string | null;
  resource: string | null;
  dataClassification: string | null;
  eventType: RuntimeEventType | null;
  sessionId: string | null;
  correlationId: string | null;
  mcpServer: string | null;
};

/** The events in a received body: one object, or a list at the definition's `records` path. */
export function eventRecords(spec: NonNullable<ReceiveSpec["runtimeEvents"]>, body: unknown): unknown[] | string {
  const list = spec.records ? readPath(body, spec.records) : Array.isArray(body) ? body : [body];
  if (!Array.isArray(list)) return spec.records ? `${spec.records}: must be a list of events` : "body must be an event or a list of events";
  if (list.length === 0) return "no events";
  if (list.length > MAX_EVENTS_PER_REQUEST) return `at most ${MAX_EVENTS_PER_REQUEST} events per request`;
  return list;
}

/** Maps one received record through the definition and validates the result, or says what is wrong. */
export function mapRuntimeEvent(spec: NonNullable<ReceiveSpec["runtimeEvents"]>, record: unknown): ReceivedRuntimeEvent | string {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return "each event must be a JSON object";
  const value = (field: keyof typeof spec.fields) => {
    const m = spec.fields[field];
    return m === undefined ? undefined : mapField(m, { record });
  };
  const text = (field: keyof typeof spec.fields, required = false): string | null | { error: string } => {
    const v = value(field);
    if (v === undefined || v === null || v === "") return required ? { error: `${field}: required` } : null;
    if (typeof v !== "string" && typeof v !== "number") return { error: `${field}: must be text` };
    const s = String(v);
    return s.length > MAX_FIELD ? { error: `${field}: at most ${MAX_FIELD} characters` } : s;
  };
  const fields = {
    externalId: text("externalId"),
    agentIdentityRef: text("agentIdentityRef"),
    eventTime: text("eventTime", true),
    action: text("action", true),
    tool: text("tool"),
    application: text("application"),
    resource: text("resource"),
    dataClassification: text("dataClassification"),
    eventType: text("eventType"),
    sessionId: text("sessionId"),
    correlationId: text("correlationId"),
    mcpServer: text("mcpServer"),
  };
  for (const v of Object.values(fields)) if (v && typeof v === "object") return v.error;
  const f = fields as Record<keyof typeof fields, string | null>;
  if (Number.isNaN(Date.parse(f.eventTime!))) return "eventTime: must be an ISO timestamp";
  if (f.eventType !== null && !RUNTIME_EVENT_TYPES.includes(f.eventType as RuntimeEventType)) return `eventType: one of ${RUNTIME_EVENT_TYPES.join(", ")}`;
  const success = value("success");
  if (typeof success !== "boolean") return "success: must be true or false";
  return { ...f, eventTime: f.eventTime!, action: f.action!, success, eventType: f.eventType as RuntimeEventType | null };
}
