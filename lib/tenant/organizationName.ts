/**
 * Organization names and slugs. Pure, so the naming rules have direct unit
 * tests (organizationName.test.ts).
 */

/** Longest organization name accepted from a person (create or rename). */
export const ORGANIZATION_NAME_MAX = 80;

/**
 * The first part of a new tenant's slug. FOUNDATION-P0-22's slug policy
 * (migration 0095: lowercase, URL-safe, 3–40 characters) leaves room for
 * the "-xxxxxx" suffix added by newTenantSlug(), so this part is at most 33
 * characters.
 */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 33)
      .replace(/-+$/, "") || "tenant"
  );
}

export function newTenantSlug(name: string): string {
  return `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Mail providers whose domain says nothing about the person's company. */
const PERSONAL_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "web.de",
  "mail.com",
  "zoho.com",
  "zohomail.com",
  "yandex.com",
  "yandex.ru",
  "rediffmail.com",
  "qq.com",
  "163.com",
  "hey.com",
  "fastmail.com",
  "tutanota.com",
]);

/** Second-level labels under a two-letter country code: acme.co.uk, acme.com.au. */
const COUNTRY_SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "or", "ne"]);

const titleCase = (words: string[]) =>
  words
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** "acme-corp" from "mail.acme-corp.co.uk", or null for a personal or unusable domain. */
function companyLabel(domain: string): string | null {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2 || PERSONAL_MAIL_DOMAINS.has(labels.join("."))) return null;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const label = labels.length >= 3 && tld.length === 2 && COUNTRY_SECOND_LEVEL.has(second) ? labels[labels.length - 3] : second;
  return /^[a-z0-9-]+$/.test(label) && /[a-z]/.test(label) ? label : null;
}

/**
 * The name a new account's first organization gets, so sign-up needs no
 * "create an organization" step. The person can rename it afterwards.
 *
 * - A company address names the company: ava@acme-corp.com → "Acme Corp".
 * - A personal address (Gmail, Outlook, …) names the person:
 *   "Ava's organization", from the provider's full name, else the address.
 */
export function firstOrganizationName(email: string | null | undefined, fullName?: string | null): string {
  const [local = "", domain = ""] = (email ?? "").trim().split("@");
  const company = domain ? companyLabel(domain) : null;
  if (company) return titleCase(company.split("-")).slice(0, ORGANIZATION_NAME_MAX);

  const first = (fullName ?? "").trim().split(/\s+/)[0] || titleCase([local.split(/[._+\-0-9]+/).filter(Boolean)[0] ?? ""]);
  return first ? `${first.slice(0, 60)}'s organization` : "My organization";
}
