import type { McpToolOperation } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-06 — the deterministic (#9) classification of an MCP
 * tool, applied by the connector framework's mcp driver: a tool's operation
 * comes from the server's own annotations when it gives them
 * (`readOnlyHint`, `destructiveHint`), otherwise from the verb its name
 * starts with, otherwise "unknown". A server's description text is never
 * interpreted as an instruction (§17.2); it is stored as data.
 */

const READ_VERBS = new Set(["get", "list", "read", "search", "query", "fetch", "find", "describe", "show", "view", "lookup", "count", "check", "inspect", "browse"]);
const WRITE_VERBS = new Set([
  "create", "update", "delete", "remove", "write", "send", "post", "put", "patch", "set", "insert", "drop", "execute", "run",
  "transfer", "pay", "grant", "revoke", "approve", "modify", "add", "upload", "move", "rename", "invoke", "trigger", "deploy",
]);

function firstVerb(name: string): string {
  // snake_case, kebab-case, dotted and camelCase all split to their first word.
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").split(/[_\-.\s/:]+/)[0]?.toLowerCase() ?? "";
}

export function classifyToolOperation(name: string, annotations: unknown): { operation: McpToolOperation; basis: "annotation" | "name" | "none"; destructive: boolean } {
  const a = (typeof annotations === "object" && annotations !== null ? annotations : {}) as Record<string, unknown>;
  const destructive = a.destructiveHint === true;
  if (a.readOnlyHint === true && !destructive) return { operation: "read", basis: "annotation", destructive: false };
  if (a.readOnlyHint === false || destructive) return { operation: "write", basis: "annotation", destructive };
  const verb = firstVerb(name);
  if (READ_VERBS.has(verb)) return { operation: "read", basis: "name", destructive: false };
  if (WRITE_VERBS.has(verb)) return { operation: "write", basis: "name", destructive: verb === "delete" || verb === "drop" || verb === "remove" };
  return { operation: "unknown", basis: "none", destructive: false };
}

/**
 * Owner feedback 2026-10-14: a tool can itself be an AI agent (it drafts,
 * answers or generates with a model behind it), not just an operation on
 * data. Decided deterministically (#9) from what the server declared: the
 * description naming AI, or the name starting with a generative verb. The
 * reason is returned, so a reviewer sees why. It is a signal for the agent
 * discovery inbox, where a person decides; it changes no access.
 */
const AI_VERBS = new Set(["draft", "generate", "summarize", "summarise", "ask", "chat", "compose", "translate", "rewrite", "paraphrase", "answer", "suggest"]);
const AI_DESCRIPTION = /\b(AI|A\.I\.|LLM|GPT|language model|generative|machine learning|AI[- ]powered|AI assistant|chatbot)\b/i;

export type McpToolKind = { kind: "ai_agent" | "tool"; reason: string | null };
export type DeclaredEntity = "ai_agent" | "tool";
export type DeclaredAutonomy = "answer_only" | "draft_only";

/**
 * What the server itself declares about a tool in its `_meta` (MCP's field
 * for implementation-specific metadata; MCP has no "agent" type). WonderApps
 * servers declare `"wonderapps.biz/entity": "ai_agent" | "tool"` and, for an
 * AI agent, `"wonderapps.biz/ai": { autonomy, output, acts }`. The keys
 * contain a dot, so they are read as exact keys, never as dotted paths.
 * Untrusted external data (§17.2): only the known values count; anything
 * else is absent. It chooses a label only, never permissions, risk or
 * autonomy (#9, #19).
 */
export type McpToolDeclaration = { entity: DeclaredEntity | null; autonomy: DeclaredAutonomy | null; aiGenerated: boolean };

const ENTITY_KEY = "wonderapps.biz/entity";
const AI_KEY = "wonderapps.biz/ai";
const own = (o: object, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined);
const isObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v);

export function readToolDeclaration(meta: unknown): McpToolDeclaration {
  const none: McpToolDeclaration = { entity: null, autonomy: null, aiGenerated: false };
  if (!isObject(meta)) return none;
  const entity = own(meta, ENTITY_KEY);
  if (entity !== "ai_agent" && entity !== "tool") return none;
  if (entity === "tool") return { entity, autonomy: null, aiGenerated: false };
  const ai = own(meta, AI_KEY);
  if (!isObject(ai)) return { entity, autonomy: null, aiGenerated: false };
  const autonomy = own(ai, "autonomy");
  return {
    entity,
    autonomy: autonomy === "answer_only" || autonomy === "draft_only" ? autonomy : null,
    aiGenerated: own(ai, "output") === "ai-generated",
  };
}

/** A stored declared entity, re-checked on read: only the known values count. */
export function declaredEntityOf(v: unknown): DeclaredEntity | null {
  return v === "ai_agent" || v === "tool" ? v : null;
}

/**
 * The server's declaration decides first; the name and description guess
 * only when there is no valid declaration.
 */
export function classifyToolKind(name: string, description: string | null, declared: DeclaredEntity | null = null): McpToolKind {
  if (declared) return { kind: declared, reason: "Declared by the server" };
  const m = description ? AI_DESCRIPTION.exec(description) : null;
  if (m) return { kind: "ai_agent", reason: `Description mentions "${m[0]}"` };
  const verb = firstVerb(name);
  if (AI_VERBS.has(verb)) return { kind: "ai_agent", reason: `Name starts with "${verb}"` };
  return { kind: "tool", reason: null };
}
