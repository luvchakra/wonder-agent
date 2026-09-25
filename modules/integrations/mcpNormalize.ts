import type { DiscoveredObject, McpToolOperation } from "@/lib/shared/types/integrations";

/**
 * INTEGRATION-P0-06 — pure normalization of what an MCP server declares
 * (`initialize`, `tools/list`, `resources/list`) into the three
 * integration_objects families. Deterministic (#9): a tool's operation
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

const text = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);

export function normalizeMcpDeclarations(input: {
  endpoint: string;
  initialize: unknown;
  tools: unknown;
  resources: unknown;
}): DiscoveredObject[] {
  const init = (typeof input.initialize === "object" && input.initialize !== null ? input.initialize : {}) as Record<string, unknown>;
  const info = (typeof init.serverInfo === "object" && init.serverInfo !== null ? init.serverInfo : {}) as Record<string, unknown>;
  const out: DiscoveredObject[] = [
    {
      // One server object per integration.
      externalRef: "server",
      objectType: "mcp_server",
      summary: {
        endpoint: input.endpoint,
        serverName: text(info.name, 200),
        serverVersion: text(info.version, 100),
        protocolVersion: text(init.protocolVersion, 50),
      },
    },
  ];

  for (const tool of Array.isArray(input.tools) ? input.tools : []) {
    if (typeof tool !== "object" || tool === null) continue;
    const t = tool as Record<string, unknown>;
    const name = text(t.name, 200);
    if (!name) continue;
    const op = classifyToolOperation(name, t.annotations);
    out.push({
      externalRef: name,
      objectType: "mcp_tool",
      summary: {
        name,
        description: text(t.description),
        operation: op.operation,
        operationBasis: op.basis,
        destructive: op.destructive,
        inputSchema: typeof t.inputSchema === "object" && t.inputSchema !== null ? t.inputSchema : null,
      },
    });
  }

  for (const resource of Array.isArray(input.resources) ? input.resources : []) {
    if (typeof resource !== "object" || resource === null) continue;
    const r = resource as Record<string, unknown>;
    const uri = text(r.uri, 1000);
    if (!uri) continue;
    out.push({ externalRef: uri, objectType: "mcp_resource", summary: { uri, name: text(r.name, 200), mimeType: text(r.mimeType, 200) } });
  }
  return out;
}
