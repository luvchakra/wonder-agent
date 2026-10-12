import { fillTemplate, type TemplateScope } from "./mapping";
import type { LdapWriteSpec } from "./types";

/**
 * INTEGRATION-P0-22 — LDAP changes, pure: the DN and attribute values a
 * declared change fills, and which directory answers mean the change is
 * already there. The ldap driver sends what this returns.
 */

/** A value inside a DN, escaped per RFC 4514 §2.4, so a name can never add or change an RDN. */
export function escapeDnValue(value: string): string {
  let out = value.replace(/[\\,+"<>;=\u0000]/g, (c) => (c === "\u0000" ? "\\00" : `\\${c}`));
  if (/^[ #]/.test(out)) out = `\\${out}`;
  if (/ $/.test(out)) out = `${out.slice(0, -1)}\\ `;
  return out;
}

const WHOLE_DN = /^\{target\.(account|entitlement)\}$/;

/** The entry's DN: a DN WonderID read, used as is, or a template with escaped values. */
export function fillDn(template: string, scope: TemplateScope): string {
  return WHOLE_DN.test(template) ? fillTemplate(template, scope) : fillTemplate(template, scope, { escape: escapeDnValue });
}

export type LdapChangePlan =
  | { kind: "modify"; dn: string; changes: { operation: "add" | "delete" | "replace"; attribute: string; values: string[] }[] }
  | { kind: "add"; dn: string; attributes: Record<string, string[]> };

export function planLdapWrite(spec: LdapWriteSpec, scope: TemplateScope): LdapChangePlan {
  const dn = fillDn(spec.dn, scope);
  const fill = (values: string[]) => values.map((v) => fillTemplate(v, scope)).filter((v) => v !== "");
  if (spec.add) return { kind: "add", dn, attributes: Object.fromEntries(Object.entries(spec.add).map(([k, v]) => [k, fill(v)])) };
  return { kind: "modify", dn, changes: (spec.modify ?? []).map((c) => ({ operation: c.operation, attribute: c.attribute, values: fill(c.values) })) };
}

/**
 * LDAP has no idempotency key, but its answers say when a change is
 * already in place: adding a value that exists (20), removing one that
 * is gone (16), creating an entry that exists (68). A retry of a change
 * the directory already applied is then done, not a failure.
 */
export function alreadyApplied(code: unknown, plan: LdapChangePlan): boolean {
  if (plan.kind === "add") return code === 68;
  const ops = new Set(plan.changes.map((c) => c.operation));
  return (code === 20 && ops.has("add") && !ops.has("delete")) || (code === 16 && ops.has("delete") && !ops.has("add"));
}
