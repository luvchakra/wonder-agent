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
