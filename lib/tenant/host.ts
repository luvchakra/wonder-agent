/**
 * FOUNDATION-P0-22 — what a request's hostname says about its tenant, pure
 * (no I/O, safe in the proxy and in unit tests).
 *
 * Each tenant is reached at `<slug>.<BASE_APP_HOST>` (docs/requirements/
 * WonderID_Tenant_User_Permissioning_Model.md §3). The hostname only
 * *addresses* a tenant: it narrows which of the signed-in user's active
 * memberships applies and never grants access (non-negotiable #2). With
 * BASE_APP_HOST unset, or on any host outside it (the bare host, preview
 * deployments), tenant selection is unchanged: the user's memberships and
 * the organization switcher.
 */

export type HostTarget =
  | { kind: "none" }
  | { kind: "base" }
  | { kind: "subdomain"; label: string }
  | { kind: "invalid"; reason: string };

/** The configured base host, lowercased, without a port or a leading dot. */
export function baseAppHost(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.BASE_APP_HOST?.trim().toLowerCase().replace(/^\.+/, "").replace(/:\d+$/, "");
  return raw ? raw : null;
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * The words no tenant may take as its slug — kept identical to
 * tenant_slug_is_valid() in migration 0095, which enforces it in the
 * database.
 */
export const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "administrator", "platform", "platform-admin", "auth", "login", "signin", "sign-in",
  "signup", "sign-up", "sso", "oauth", "mail", "email", "smtp", "static", "assets", "cdn", "media", "files", "help",
  "status", "docs", "support", "billing", "wonderid", "wonderagent", "root", "system", "internal", "test", "demo",
  "dev", "staging", "prod", "production", "localhost", "security", "account", "accounts", "dashboard", "console",
]);

/** Why a slug is not acceptable, or null when it is. */
export function slugProblem(slug: string): string | null {
  if (slug !== slug.toLowerCase()) return "Use lowercase letters";
  if (!SLUG_RE.test(slug)) return "3 to 40 letters, digits or hyphens, starting and ending with a letter or digit";
  if (slug.includes("--")) return "No double hyphens";
  if (RESERVED_SLUGS.has(slug)) return "That name is reserved";
  return null;
}

/**
 * Classifies a Host header against the base host. `acme.example.com` under
 * `example.com` addresses the `acme` tenant; `example.com` itself is the
 * base; deeper names (`a.b.example.com`) and malformed labels are invalid;
 * anything else is outside the tenant-URL scheme.
 */
export function parseTenantHost(hostHeader: string | null | undefined, base: string | null): HostTarget {
  if (!base || !hostHeader) return { kind: "none" };
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (host === base) return { kind: "base" };
  if (!host.endsWith(`.${base}`)) return { kind: "none" };
  const label = host.slice(0, -(base.length + 1));
  if (label.includes(".")) return { kind: "invalid", reason: "nested subdomain" };
  if (slugProblem(label)) return { kind: "invalid", reason: "not a tenant address" };
  return { kind: "subdomain", label };
}

/** A tenant's primary URL, when tenant URLs are configured. */
export function tenantUrl(slug: string, base: string | null, protocol = "https", port?: string | null): string | null {
  if (!base || !slug) return null;
  return `${protocol}://${slug}.${base}${port ? `:${port}` : ""}`;
}
