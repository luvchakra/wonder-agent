// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyToolKind, classifyToolOperation, declaredEntityOf, readToolDeclaration } from "./mcpNormalize";

describe("classifyToolOperation (INTEGRATION-P0-06)", () => {
  it("the server's own annotations decide first", () => {
    expect(classifyToolOperation("delete_everything", { readOnlyHint: true })).toEqual({ operation: "read", basis: "annotation", destructive: false });
    expect(classifyToolOperation("get_thing", { readOnlyHint: false })).toEqual({ operation: "write", basis: "annotation", destructive: false });
    expect(classifyToolOperation("x", { destructiveHint: true })).toEqual({ operation: "write", basis: "annotation", destructive: true });
    // Contradictory hints: destructive wins, never "read".
    expect(classifyToolOperation("x", { readOnlyHint: true, destructiveHint: true }).operation).toBe("write");
  });

  it("otherwise the leading verb of the name, in any case style", () => {
    expect(classifyToolOperation("list_customers", undefined)).toMatchObject({ operation: "read", basis: "name" });
    expect(classifyToolOperation("getInvoice", undefined)).toMatchObject({ operation: "read", basis: "name" });
    expect(classifyToolOperation("send-email", undefined)).toMatchObject({ operation: "write", basis: "name", destructive: false });
    expect(classifyToolOperation("delete.customer", undefined)).toMatchObject({ operation: "write", destructive: true });
  });

  it("says unknown rather than guessing", () => {
    expect(classifyToolOperation("customer_magic", undefined)).toEqual({ operation: "unknown", basis: "none", destructive: false });
  });
});

describe("classifyToolKind (owner feedback 2026-10-14)", () => {
  it("names WonderArk's AI tools AI agents, with the reason", () => {
    expect(classifyToolKind("draft_whatsapp_reply", "Drafts an answer to the latest customer message in one of the business's WhatsApp chats.")).toEqual({ kind: "ai_agent", reason: 'Name starts with "draft"' });
    expect(classifyToolKind("ask_assistant", "Asks WonderArk's AI assistant a question about this business.")).toEqual({ kind: "ai_agent", reason: 'Description mentions "AI"' });
    expect(classifyToolKind("summarizeTicket", null)).toEqual({ kind: "ai_agent", reason: 'Name starts with "summarize"' });
    expect(classifyToolKind("lookup", "Uses an LLM to find the closest match.").kind).toBe("ai_agent");
  });

  it("leaves plain data tools as tools", () => {
    expect(classifyToolKind("get_record", "Reads one record of one kind from this business by its id.")).toEqual({ kind: "tool", reason: null });
    expect(classifyToolKind("list_records", "Lists records of one kind, newest first.")).toEqual({ kind: "tool", reason: null });
    // "air", "maid" and "paid" contain "ai" but are not the word.
    expect(classifyToolKind("update_invoice", "Marks an invoice paid; repairs the air-gapped mirror.").kind).toBe("tool");
  });
});

describe("the server's declaration (owner request 2026-10-15)", () => {
  it("wins over the name and wording guess, in both directions", () => {
    expect(classifyToolKind("draft_x", "Drafts a reply with AI.", "tool")).toEqual({ kind: "tool", reason: "Declared by the server" });
    expect(classifyToolKind("fetch_x", "Fetches a record.", "ai_agent")).toEqual({ kind: "ai_agent", reason: "Declared by the server" });
  });

  it("falls back to the guess when the declared value is invalid or unknown", () => {
    expect(classifyToolKind("draft_x", null, declaredEntityOf("agent"))).toEqual({ kind: "ai_agent", reason: 'Name starts with "draft"' });
    expect(classifyToolKind("fetch_x", null, declaredEntityOf(42))).toEqual({ kind: "tool", reason: null });
    expect(readToolDeclaration({ "wonderapps.biz/entity": "AI_AGENT" })).toEqual({ entity: null, autonomy: null, aiGenerated: false });
  });

  it("with no `_meta`, behaves exactly as before", () => {
    expect(readToolDeclaration(undefined)).toEqual({ entity: null, autonomy: null, aiGenerated: false });
    expect(readToolDeclaration(["wonderapps.biz/entity"])).toEqual({ entity: null, autonomy: null, aiGenerated: false });
    expect(classifyToolKind("draft_whatsapp_reply", "x", readToolDeclaration(undefined).entity)).toEqual(classifyToolKind("draft_whatsapp_reply", "x"));
    expect(classifyToolKind("get_record", "Reads one record.", readToolDeclaration(null).entity)).toEqual({ kind: "tool", reason: null });
  });

  it("reads keys that contain a dot as exact keys, with only the known autonomy values", () => {
    expect(readToolDeclaration({ "wonderapps.biz/entity": "ai_agent", "wonderapps.biz/ai": { autonomy: "answer_only", output: "ai-generated", acts: false } })).toEqual({ entity: "ai_agent", autonomy: "answer_only", aiGenerated: true });
    expect(readToolDeclaration({ "wonderapps.biz/entity": "ai_agent", "wonderapps.biz/ai": { autonomy: "acts_freely", output: "human" } })).toEqual({ entity: "ai_agent", autonomy: null, aiGenerated: false });
    // Not the dotted key: a nested object, or an inherited property.
    expect(readToolDeclaration({ wonderapps: { "biz/entity": "ai_agent" } }).entity).toBeNull();
    expect(readToolDeclaration(Object.create({ "wonderapps.biz/entity": "ai_agent" })).entity).toBeNull();
    // A tool's AI block is ignored.
    expect(readToolDeclaration({ "wonderapps.biz/entity": "tool", "wonderapps.biz/ai": { autonomy: "draft_only", output: "ai-generated" } })).toEqual({ entity: "tool", autonomy: null, aiGenerated: false });
  });
});
