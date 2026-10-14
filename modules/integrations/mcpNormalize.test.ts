// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyToolKind, classifyToolOperation } from "./mcpNormalize";

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
