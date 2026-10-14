import { ApiError } from "@/lib/shared/types/foundation";

/**
 * The account name a request's placeholder account gets (ACCESS-P0-28),
 * from the application's onboarding format (ACCESS-P0-16), pure (#9).
 *
 * A format is literal text and placeholders drawn from the identity's own
 * attributes, e.g. `{firstName}.{lastName}` or `{emailName:lower}`. The
 * name is only what the account will be called: the placeholder is still
 * recognised by its `pending` status and matched to the real account by
 * its identity, never by this name.
 */

export const ACCOUNT_NAME_PLACEHOLDERS = ["firstName", "lastName", "email", "emailName", "username"] as const;
export type AccountNamePlaceholder = (typeof ACCOUNT_NAME_PLACEHOLDERS)[number];
export type AccountNameSubject = { displayName: string | null; email: string | null; username: string | null };

export const MAX_ACCOUNT_NAME_FORMAT = 100;
const MAX_NAME = 100;
const TOKEN_RE = /\{([A-Za-z]+)(?::(lower))?\}/g;
const LITERAL_RE = /^[A-Za-z0-9._@-]*$/;

/** Shown when a placeholder from before account name formats has no name. */
export const PENDING_ACCOUNT_LABEL = "to be created";

/** Validates a format; empty means the default. Throws 400 with what is wrong. */
export function validateAccountNameFormat(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, "VALIDATION_FAILED", "accountNameFormat: text");
  const v = value.trim();
  if (!v) return null;
  if (v.length > MAX_ACCOUNT_NAME_FORMAT) throw new ApiError(400, "VALIDATION_FAILED", `accountNameFormat: at most ${MAX_ACCOUNT_NAME_FORMAT} characters`);
  let found = 0;
  for (const m of v.matchAll(TOKEN_RE)) {
    if (!(ACCOUNT_NAME_PLACEHOLDERS as readonly string[]).includes(m[1])) {
      throw new ApiError(400, "VALIDATION_FAILED", `accountNameFormat: unknown placeholder {${m[1]}}; use ${ACCOUNT_NAME_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}`);
    }
    found++;
  }
  if (!found) throw new ApiError(400, "VALIDATION_FAILED", "accountNameFormat: needs at least one placeholder, e.g. {firstName}.{lastName}");
  if (!LITERAL_RE.test(v.replace(TOKEN_RE, ""))) throw new ApiError(400, "VALIDATION_FAILED", "accountNameFormat: outside placeholders, only letters, digits and . _ @ -");
  return v;
}

/** Letters, digits and . _ @ - only, accents dropped ("José" → "Jose"). */
function clean(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._@-]/g, "");
}

function trimName(value: string): string {
  return value.slice(0, MAX_NAME).replace(/^[._@-]+|[._@-]+$/g, "");
}

function values(s: AccountNameSubject): Record<AccountNamePlaceholder, string> {
  const words = (s.displayName ?? "").trim().split(/\s+/).filter(Boolean);
  const email = (s.email ?? "").trim();
  return {
    firstName: clean(words[0] ?? ""),
    lastName: clean(words.length > 1 ? words[words.length - 1] : ""),
    email: clean(email),
    emailName: clean(email.includes("@") ? email.slice(0, email.indexOf("@")) : ""),
    username: clean((s.username ?? "").trim()),
  };
}

/**
 * The default, human readable without a format: the username, else the
 * email's local part, else first.last from the display name, lowercased
 * when derived. Null when the identity has none of these.
 */
export function defaultAccountName(s: AccountNameSubject): string | null {
  const v = values(s);
  const name = v.username || v.emailName.toLowerCase() || [v.firstName, v.lastName].filter(Boolean).join(".").toLowerCase();
  return trimName(name) || null;
}

/**
 * The name for a subject under a format. A placeholder the identity has no
 * value for makes the format unusable for it, and the default is used, so a
 * name is never half built ("jane." for someone with no last name).
 */
export function formatAccountName(format: string | null | undefined, s: AccountNameSubject): string | null {
  if (!format) return defaultAccountName(s);
  const v = values(s);
  let missing = false;
  const name = format.replace(TOKEN_RE, (_m, key: string, lower?: string) => {
    const value = v[key as AccountNamePlaceholder] ?? "";
    if (!value) missing = true;
    return lower ? value.toLowerCase() : value;
  });
  if (missing) return defaultAccountName(s);
  return trimName(clean(name)) || defaultAccountName(s);
}

/** An agent's account: its name as a slug ("Finance Bot" → "finance-bot"). */
export function agentAccountName(name: string | null): string | null {
  const slug = clean((name ?? "").trim().toLowerCase().replace(/\s+/g, "-")).replace(/-{2,}/g, "-");
  return trimName(slug) || null;
}

/** The candidates in order: the name, then name-2, name-3 … */
export function accountNameCandidates(base: string, count = 20): string[] {
  const out = [base];
  for (let i = 2; i <= count; i++) {
    const suffix = `-${i}`;
    out.push(`${base.slice(0, MAX_NAME - suffix.length)}${suffix}`);
  }
  return out;
}

/** The first candidate not taken in the application (case-insensitive); null when all are. */
export function uniqueAccountName(base: string, taken: Iterable<string>): string | null {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  return accountNameCandidates(base).find((c) => !used.has(c.toLowerCase())) ?? null;
}

/**
 * How an account reads: its name, else its reference, except that a
 * request's placeholder from before formats existed reads "to be created",
 * never its internal `pending:` reference.
 */
export function accountDisplayName(accountName: string | null | undefined, externalRef: string | null | undefined): string | null {
  if (accountName) return accountName;
  if (!externalRef) return null;
  return externalRef.startsWith("pending:") ? PENDING_ACCOUNT_LABEL : externalRef;
}
