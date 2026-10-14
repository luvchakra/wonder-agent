/**
 * OPERATIONS-P0-11 (runtime part, decision D12) — the rule condition
 * language of design §5.2.1: a small typed expression language evaluated by
 * code, never by a model and never as SQL (non-negotiables #9, #19).
 *
 *   identity.department = "Finance" and not identity.contractor
 *   new.title != old.title and manager.status in ["active", "leave"]
 *   identity.email matches "@acme\\.com$"
 *   exists identity.costCentre
 *   changed identity.department
 *   identity.department was "Sales"           (old value, for change triggers)
 *
 * Grammar (precedence low → high): or · and · not · comparison · primary.
 * Comparisons: = != ≠ < > <= >= in matches was. Unary: not, exists, changed.
 * Primary: string ("…" or '…'), number, true, false, null, [list], (expr), or
 * a reference `root.path` whose root is one of REFERENCE_ROOTS.
 *
 * Pure (#9): no I/O, no clock, deterministic. Unknown references evaluate
 * to undefined, and any comparison with undefined is false (fail closed),
 * except `exists` and `!=`.
 */

export const REFERENCE_ROOTS = ["identity", "old", "new", "manager", "owner", "sponsor", "organization", "source", "application", "entitlement", "event"] as const;
export type ReferenceRoot = (typeof REFERENCE_ROOTS)[number];

export type Expr =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "list"; items: Expr[] }
  | { kind: "ref"; root: ReferenceRoot; path: string[] }
  | { kind: "not"; operand: Expr }
  | { kind: "exists"; operand: Expr }
  | { kind: "changed"; operand: Expr }
  | { kind: "and" | "or"; left: Expr; right: Expr }
  | { kind: "compare"; op: "=" | "!=" | "<" | ">" | "<=" | ">=" | "in" | "matches" | "was"; left: Expr; right: Expr };

export class RuleSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} (at ${position + 1})`);
  }
}

type Token = { type: "string" | "number" | "word" | "op" | "punct"; value: string; pos: number };

const MAX_LENGTH = 4000;
const MAX_DEPTH = 32;
const MAX_PATTERN = 200;
const MAX_MATCHED = 2000;

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) throw new RuleSyntaxError(`A condition is at most ${MAX_LENGTH} characters`, MAX_LENGTH);
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let out = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          out += src[j + 1];
          j += 2;
          continue;
        }
        out += src[j++];
      }
      if (j >= src.length) throw new RuleSyntaxError("Unclosed text", i);
      tokens.push({ type: "string", value: out, pos: i });
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num && (c !== "-" || !tokens.length || ["op", "punct"].includes(tokens[tokens.length - 1].type) || ["in", "and", "or", "not"].includes(tokens[tokens.length - 1].value))) {
      tokens.push({ type: "number", value: num[0], pos: i });
      i += num[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["!=", "<=", ">="].includes(two)) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (c === "≠") {
      tokens.push({ type: "op", value: "!=", pos: i });
      i++;
      continue;
    }
    if (["=", "<", ">"].includes(c)) {
      tokens.push({ type: "op", value: c, pos: i });
      i++;
      continue;
    }
    if (["(", ")", "[", "]", ","].includes(c)) {
      tokens.push({ type: "punct", value: c, pos: i });
      i++;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
    if (word) {
      tokens.push({ type: "word", value: word[0], pos: i });
      i += word[0].length;
      continue;
    }
    throw new RuleSyntaxError(`Unexpected "${c}"`, i);
  }
  return tokens;
}

const KEYWORDS = new Set(["and", "or", "not", "in", "matches", "exists", "changed", "was", "true", "false", "null"]);

/** Parses a condition. Throws RuleSyntaxError with the position of the problem. */
export function parseCondition(src: string): Expr {
  const tokens = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => tokens[p];
  const atWord = (w: string) => peek()?.type === "word" && peek()!.value.toLowerCase() === w;
  const expect = (value: string) => {
    const t = peek();
    if (!t || t.value !== value) throw new RuleSyntaxError(`Expected "${value}"`, t?.pos ?? src.length);
    p++;
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new RuleSyntaxError("The condition is nested too deeply", peek()?.pos ?? src.length);
  };

  function or(): Expr {
    let left = and();
    while (atWord("or")) {
      p++;
      left = { kind: "or", left, right: and() };
    }
    return left;
  }
  function and(): Expr {
    let left = unary();
    while (atWord("and")) {
      p++;
      left = { kind: "and", left, right: unary() };
    }
    return left;
  }
  function unary(): Expr {
    enter();
    try {
      if (atWord("not")) {
        p++;
        return { kind: "not", operand: unary() };
      }
      if (atWord("exists") || atWord("changed")) {
        const kind = peek()!.value.toLowerCase() as "exists" | "changed";
        p++;
        const operand = primary();
        if (operand.kind !== "ref") throw new RuleSyntaxError(`"${kind}" takes a reference such as identity.department`, peek()?.pos ?? src.length);
        return { kind, operand };
      }
      return comparison();
    } finally {
      depth--;
    }
  }
  function comparison(): Expr {
    const left = primary();
    const t = peek();
    if (t?.type === "op") {
      p++;
      return { kind: "compare", op: t.value as "=" | "!=" | "<" | ">" | "<=" | ">=", left, right: primary() };
    }
    if (atWord("in") || atWord("matches") || atWord("was")) {
      const op = peek()!.value.toLowerCase() as "in" | "matches" | "was";
      p++;
      const right = primary();
      if (op === "in" && right.kind !== "list" && right.kind !== "ref") throw new RuleSyntaxError('"in" takes a list such as ["a", "b"]', peek()?.pos ?? src.length);
      if (op === "matches") {
        if (right.kind !== "literal" || typeof right.value !== "string") throw new RuleSyntaxError('"matches" takes a pattern in quotes', peek()?.pos ?? src.length);
        // Bounded patterns only: no catastrophic backtracking from a rule (a rule runs on every event).
        if (right.value.length > MAX_PATTERN || /\([^)]*[+*}]\)[+*{]/.test(right.value))
          throw new RuleSyntaxError(`A pattern is at most ${MAX_PATTERN} characters, without nested repeats`, t?.pos ?? src.length);
        try {
          new RegExp(right.value);
        } catch {
          throw new RuleSyntaxError("Not a valid pattern", t?.pos ?? src.length);
        }
      }
      if (op === "was" && left.kind !== "ref") throw new RuleSyntaxError('"was" compares a reference with its old value', t?.pos ?? src.length);
      return { kind: "compare", op, left, right };
    }
    return left;
  }
  function primary(): Expr {
    const t = peek();
    if (!t) throw new RuleSyntaxError("The condition ends too soon", src.length);
    if (t.type === "string") {
      p++;
      return { kind: "literal", value: t.value };
    }
    if (t.type === "number") {
      p++;
      return { kind: "literal", value: Number(t.value) };
    }
    if (t.value === "(") {
      p++;
      enter();
      const e = or();
      depth--;
      expect(")");
      return e;
    }
    if (t.value === "[") {
      p++;
      const items: Expr[] = [];
      while (peek() && peek()!.value !== "]") {
        const item = primary();
        if (item.kind !== "literal") throw new RuleSyntaxError("A list holds plain values", peek()?.pos ?? src.length);
        items.push(item);
        if (peek()?.value === ",") p++;
        else break;
      }
      expect("]");
      if (items.length > 200) throw new RuleSyntaxError("A list holds at most 200 values", t.pos);
      return { kind: "list", items };
    }
    if (t.type === "word") {
      const lower = t.value.toLowerCase();
      if (lower === "true" || lower === "false") {
        p++;
        return { kind: "literal", value: lower === "true" };
      }
      if (lower === "null") {
        p++;
        return { kind: "literal", value: null };
      }
      if (KEYWORDS.has(lower)) throw new RuleSyntaxError(`Unexpected "${t.value}"`, t.pos);
      const [root, ...path] = t.value.split(".");
      if (!(REFERENCE_ROOTS as readonly string[]).includes(root)) throw new RuleSyntaxError(`Unknown reference "${t.value}": start with ${REFERENCE_ROOTS.join(", ")}`, t.pos);
      if (!path.length) throw new RuleSyntaxError(`Name a field, such as ${root}.department`, t.pos);
      p++;
      return { kind: "ref", root: root as ReferenceRoot, path };
    }
    throw new RuleSyntaxError(`Unexpected "${t.value}"`, t.pos);
  }

  const expr = or();
  if (p < tokens.length) throw new RuleSyntaxError(`Unexpected "${tokens[p].value}"`, tokens[p].pos);
  return expr;
}

/** What a rule sees: each root's record (attributes flattened under it). */
export type RuleContext = Partial<Record<ReferenceRoot, Record<string, unknown> | null | undefined>>;

function resolve(ref: Extract<Expr, { kind: "ref" }>, ctx: RuleContext): unknown {
  let v: unknown = ctx[ref.root];
  for (const key of ref.path) {
    if (v === null || v === undefined || typeof v !== "object") return undefined;
    // Own properties only: a condition can never reach prototype members.
    v = Object.prototype.hasOwnProperty.call(v, key) ? (v as Record<string, unknown>)[key] : undefined;
  }
  return v;
}

function value(e: Expr, ctx: RuleContext): unknown {
  switch (e.kind) {
    case "literal":
      return e.value;
    case "list":
      return e.items.map((i) => value(i, ctx));
    case "ref":
      return resolve(e, ctx);
    default:
      return evaluate(e, ctx);
  }
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b))) return a === Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a))) return b === Number(a);
  return a === b;
}

function order(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    // ISO dates and plain text compare as text; numbers written as text compare as numbers.
    if (a.trim() !== "" && b.trim() !== "" && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) - Number(b);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "number" && typeof b === "string" && !Number.isNaN(Number(b))) return a - Number(b);
  if (typeof a === "string" && typeof b === "number" && !Number.isNaN(Number(a))) return Number(a) - b;
  return null;
}

/** Evaluates a parsed condition to true or false. */
export function evaluate(e: Expr, ctx: RuleContext): boolean {
  switch (e.kind) {
    case "literal":
      return e.value === true;
    case "list":
      return e.items.length > 0;
    case "ref":
      return resolve(e, ctx) === true;
    case "not":
      return !evaluate(e.operand, ctx);
    case "and":
      return evaluate(e.left, ctx) && evaluate(e.right, ctx);
    case "or":
      return evaluate(e.left, ctx) || evaluate(e.right, ctx);
    case "exists": {
      const v = value(e.operand, ctx);
      return v !== undefined && v !== null && v !== "";
    }
    case "changed": {
      const ref = e.operand as Extract<Expr, { kind: "ref" }>;
      const field = ref.root === "identity" || ref.root === "new" || ref.root === "old" ? ref.path : null;
      if (!field) return false;
      const before = resolve({ kind: "ref", root: "old", path: field }, ctx);
      const after = resolve({ kind: "ref", root: "new", path: field }, ctx);
      if (before === undefined && after === undefined) return false;
      return !same(before ?? null, after ?? null);
    }
    case "compare": {
      const left = value(e.left, ctx);
      if (e.op === "was") {
        const ref = e.left as Extract<Expr, { kind: "ref" }>;
        const old = resolve({ kind: "ref", root: "old", path: ref.path }, ctx);
        return old !== undefined && same(old, value(e.right, ctx));
      }
      const right = value(e.right, ctx);
      if (e.op === "!=") return !same(left ?? null, right ?? null);
      if (left === undefined || right === undefined) return false;
      switch (e.op) {
        case "=":
          return same(left, right);
        case "in":
          return Array.isArray(right) && right.some((r) => same(left, r));
        case "matches":
          return typeof left === "string" && typeof right === "string" && new RegExp(right, "i").test(left.slice(0, MAX_MATCHED));
        default: {
          const d = order(left, right);
          if (d === null) return false;
          return e.op === "<" ? d < 0 : e.op === ">" ? d > 0 : e.op === "<=" ? d <= 0 : d >= 0;
        }
      }
    }
  }
}

/** Every reference a condition reads, as "root.path". */
export function references(e: Expr): string[] {
  const out = new Set<string>();
  const walk = (x: Expr) => {
    if (x.kind === "ref") out.add(`${x.root}.${x.path.join(".")}`);
    else if (x.kind === "list") x.items.forEach(walk);
    else if (x.kind === "not" || x.kind === "exists" || x.kind === "changed") walk(x.operand);
    else if (x.kind === "and" || x.kind === "or" || x.kind === "compare") {
      walk(x.left);
      walk(x.right);
    }
  };
  walk(e);
  return [...out];
}

/**
 * Validates a condition against what the tenant has: for identity-shaped
 * roots (identity, old, new, manager, owner, sponsor), the first field must
 * be a standard field or an attribute the tenant defined (design §5.2.1:
 * "a rule that names an attribute the tenant has not defined fails
 * validation"). Returns problems in words; empty when valid.
 */
export function validateCondition(src: string, known: { identityFields: Iterable<string> }): { ok: true; expr: Expr; references: string[] } | { ok: false; errors: string[] } {
  let expr: Expr;
  try {
    expr = parseCondition(src);
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : "Not a valid condition"] };
  }
  const fields = new Set([...known.identityFields].map((f) => f.toLowerCase()));
  const identityRoots = new Set(["identity", "old", "new", "manager", "owner", "sponsor"]);
  const refs = references(expr);
  const errors = refs
    .filter((r) => {
      const [root, field] = r.split(".");
      return identityRoots.has(root) && !fields.has(field.toLowerCase());
    })
    .map((r) => `Unknown attribute "${r}": define it first, or use a standard field`);
  return errors.length ? { ok: false, errors } : { ok: true, expr, references: refs };
}
