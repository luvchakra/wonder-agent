import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * QA-P0-21 (spec 37A.34 INJECTION; CLAUDE.md §18.3 rule 8) — a PostgREST
 * `or()` filter is a string the database parses: a comma, a bracket or a
 * wildcard in typed text would add a clause of its own. So every value put
 * into an `or()` template must be one of:
 *
 * - a server value: the session's tenant or user, a UUID the function checks
 *   or loads first, or a timestamp the code computed (SERVER_VALUES);
 * - a search term cleaned in the same file by one of CLEANERS before use.
 *
 * A new interpolation fails this test until it is added here with its reason.
 */

const ROOT = join(__dirname, "..", "..");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules") out.push(...files(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SERVER_VALUES: Record<string, string> = {
  tenantId: "the server-resolved tenant (getTenantContext)",
  userId: "the signed-in user's id",
  identityId: "checked against UUID_RE before the query",
  agentId: "checked against a UUID pattern (sod.ts) or loaded with getAgent first (evaluate.ts)",
  'named.join(",")': "user ids filtered through UUID_RE",
  since: "a timestamp the code computes",
  stale: "a timestamp the code computes",
  asOf: "an ISO timestamp the caller parsed",
  nowIso: "the current time",
};

/** Values safe only in one file, with the check that makes them so. */
const FILE_VALUES: Record<string, (expr: string) => boolean> = {
  // A page cursor's timestamp and UUID, checked by decodeCursor.
  "modules/runtime-assurance/events.ts": (e) => e === "eventTime" || e === "id",
  // A department with quotes, braces and commas removed inline.
  "modules/access-governance/packages.ts": (e) => e.startsWith('dept.replace(/["\\\\{'),
};

/** Search-term cleaners: each removes `,`, `(`, `)` and the wildcards. */
const CLEANERS = [/\.replace\(\/\[%_,\(\)\*\\\\\]\/g, " "\)/, /\.replace\(\/\[\^A-Za-z0-9_\.:\/@-\]\/g, ""\)/];
const SEARCH_TERMS = new Set(["q", "term"]);

type Use = { file: string; expr: string };

function interpolations(): Use[] {
  const uses: Use[] = [];
  for (const dir of ["lib", "modules", "app"]) {
    for (const f of files(join(ROOT, dir))) {
      const source = readFileSync(f, "utf8");
      for (const m of source.matchAll(/\.or\(`([^`]*)`/g)) {
        for (const e of m[1]!.matchAll(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) uses.push({ file: relative(ROOT, f).split("\\").join("/"), expr: e[1]!.trim() });
      }
    }
  }
  return uses;
}

describe("PostgREST or() filters never carry raw typed text", () => {
  const uses = interpolations();

  it("finds the or() filters it checks", () => {
    expect(uses.length).toBeGreaterThan(10);
  });

  it("interpolates only server values or a cleaned search term", () => {
    const bad = uses.filter(({ file, expr }) => {
      if (expr in SERVER_VALUES) return false;
      if (FILE_VALUES[file]?.(expr)) return false;
      if (SEARCH_TERMS.has(expr)) {
        const source = readFileSync(join(ROOT, file), "utf8");
        return !CLEANERS.some((c) => c.test(source));
      }
      return true;
    });
    expect(bad).toEqual([]);
  });

  it("the cleaners leave nothing that can start a clause or a wildcard", () => {
    const clean = [(s: string) => s.trim().replace(/[%_,()*\\]/g, " ").trim(), (s: string) => s.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.:/@-]/g, "")];
    const attack = "x%,tenant_id.neq.0,id.not.is.null),or(name.ilike.*\\";
    for (const c of clean) expect(c(attack)).not.toMatch(/[,()*%\\]/);
  });
});
