import { PERMISSION_MODULES, type CatalogPermission, type PermissionModule } from "./catalog";

/**
 * FOUNDATION-P0-25 — the pure rules for roles (spec §15–17, 21–22): what a
 * custom role must carry, the rule that designing a role never escalates
 * (you can put into a role only permissions you hold yourself), and the
 * per-module permission summary of a role.
 */

export type RoleInput = { name?: unknown; description?: unknown; permissions?: unknown };
export type ValidRole = { name: string; description: string; permissions: string[] };

export function validateRoleInput(input: RoleInput, catalogKeys: readonly string[]): { ok: true; value: ValidRole } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 3 || name.length > 60) errors.name = "Give the role a name of 3 to 60 characters.";
  else if (!/^[\p{L}\p{N}][\p{L}\p{N} &()/.,'-]*$/u.test(name)) errors.name = "Use letters, numbers, spaces and simple punctuation.";
  const description = typeof input.description === "string" ? input.description.trim().replace(/\s+/g, " ") : "";
  if (!description) errors.description = "Say what the role is for.";
  else if (description.length > 500) errors.description = "Keep the description under 500 characters.";
  const raw = Array.isArray(input.permissions) ? input.permissions : [];
  const permissions = [...new Set(raw.filter((p): p is string => typeof p === "string"))].sort();
  const unknown = permissions.filter((p) => !catalogKeys.includes(p));
  if (unknown.length) errors.permissions = `Not in the permission catalog: ${unknown.join(", ")}`;
  else if (!permissions.length) errors.permissions = "Choose at least one permission.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, description, permissions } };
}

/**
 * Designing a role never escalates: every permission a role *gains* must be
 * one its designer holds. (Permissions the role already had may stay even
 * if the current editor lacks them; removing is always allowed.)
 */
export function escalationIn(next: readonly string[], previous: readonly string[], actorHolds: readonly string[]): string[] {
  const had = new Set(previous);
  const holds = new Set(actorHolds);
  return next.filter((p) => !had.has(p) && !holds.has(p));
}

export type ModuleSummary = { module: PermissionModule; granted: number; total: number };

/** "Agents 18 / 22" — per module, how many of the catalog's permissions the role holds (spec §22). */
export function moduleSummary(rolePermissions: readonly string[], catalog: readonly Pick<CatalogPermission, "key" | "module">[]): ModuleSummary[] {
  const held = new Set(rolePermissions);
  return PERMISSION_MODULES.map((module) => {
    const inModule = catalog.filter((p) => p.module === module);
    return { module, granted: inModule.filter((p) => held.has(p.key)).length, total: inModule.length };
  });
}

/** The change a role edit makes, for the audit log (keys only). */
export function permissionDiff(next: readonly string[], previous: readonly string[]): { added: string[]; removed: string[] } {
  const n = new Set(next);
  const p = new Set(previous);
  return { added: [...n].filter((k) => !p.has(k)).sort(), removed: [...p].filter((k) => !n.has(k)).sort() };
}
