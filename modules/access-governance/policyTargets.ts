import { ApiError } from "@/lib/shared/types/foundation";
import { POLICY_TARGET_TYPES, type PolicyTarget, type PolicyTargetType, type RuntimeRequest } from "@/lib/shared/types/access-governance";

/**
 * ACCESS-P0-12 — policy targets, pure (#9). See PolicyTarget for the
 * matching rules. Used by the runtime decision function to decide which
 * policies apply to a request, and by create/update to validate input.
 */

const MAX_TARGETS = 50;
const lc = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

function matchesOne(target: PolicyTarget, req: Pick<RuntimeRequest, "tool" | "mcpServer" | "resource" | "application" | "action">): boolean {
  const v = lc(target.value);
  if (!v) return false;
  switch (target.type) {
    case "TOOL":
      return v === lc(req.tool);
    case "MCP_SERVER":
      return v === lc(req.mcpServer);
    case "MCP_TOOL": {
      const i = v.indexOf(":");
      if (i <= 0) return false;
      return v.slice(0, i) === lc(req.mcpServer) && v.slice(i + 1) === lc(req.tool);
    }
    case "DATA_SOURCE":
      return v === lc(req.resource) || v === lc(req.application);
    case "DATA_RESOURCE": {
      const resource = lc(req.resource);
      if (!resource) return false;
      return v.endsWith("*") ? resource.startsWith(v.slice(0, -1)) : resource === v;
    }
    case "ACTION":
      return v === lc(req.action);
  }
}

/** True when the policy applies: no targets, or at least one target matches. */
export function policyAppliesTo(targets: PolicyTarget[] | undefined, req: Pick<RuntimeRequest, "tool" | "mcpServer" | "resource" | "application" | "action">): boolean {
  if (!targets || targets.length === 0) return true;
  return targets.some((t) => matchesOne(t, req));
}

/** Reads targets out of a stored scope, ignoring anything malformed (a malformed target never matches). */
export function targetsFromScope(scope: unknown): PolicyTarget[] {
  const raw = (scope as { targets?: unknown } | null)?.targets;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is PolicyTarget =>
      typeof t === "object" && t !== null && POLICY_TARGET_TYPES.includes((t as PolicyTarget).type) && typeof (t as PolicyTarget).value === "string",
  );
}

/** Validates targets at the boundary (400 on anything invalid). */
export function validateTargets(raw: unknown): PolicyTarget[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TARGETS) throw new ApiError(400, "VALIDATION_FAILED", `scope.targets: a list of at most ${MAX_TARGETS} targets`);
  return raw.map((t, i) => {
    const type = (t as { type?: unknown })?.type;
    const value = (t as { value?: unknown })?.value;
    if (!POLICY_TARGET_TYPES.includes(type as PolicyTargetType)) throw new ApiError(400, "VALIDATION_FAILED", `scope.targets[${i}].type: one of ${POLICY_TARGET_TYPES.join(", ")}`);
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new ApiError(400, "VALIDATION_FAILED", `scope.targets[${i}].value: text of 1 to 200 characters`);
    if (type === "MCP_TOOL" && !/^[^:]+:.+$/.test(value.trim())) throw new ApiError(400, "VALIDATION_FAILED", `scope.targets[${i}].value: "<server>:<tool>"`);
    return { type: type as PolicyTargetType, value: value.trim() };
  });
}
