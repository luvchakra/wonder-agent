/**
 * Owner request (2026-10-13): pure validation of an organization's details
 * (platform console). Mirrors the database checks of migration 0162, so a
 * bad value is refused in words before it reaches the database. Empty
 * means "not recorded" (null), never a placeholder (§19.2).
 */
export type OrganizationProfile = {
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  companyName: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  industry: string | null;
  userBaseSize: string | null;
  country: string | null;
  website: string | null;
};

export const USER_BASE_SIZES = ["1-50", "51-200", "201-1000", "1001-5000", "5001-20000", "20000+"] as const;

export const INDUSTRIES = [
  "Financial services",
  "Banking",
  "Insurance",
  "Healthcare",
  "Life sciences",
  "Technology",
  "Telecommunications",
  "Retail",
  "Manufacturing",
  "Energy and utilities",
  "Government",
  "Education",
  "Media",
  "Transportation and logistics",
  "Professional services",
  "Other",
] as const;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9 ()-]{6,24}$/;
const WEBSITE = /^https?:\/\/\S+$/i;

type Result = { ok: true; value: OrganizationProfile } | { ok: false; errors: Record<string, string> };

export function validateOrganizationProfile(raw: Record<string, unknown>): Result {
  const text = (key: string) => {
    const v = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    return v === "" ? null : v;
  };
  const value: OrganizationProfile = {
    description: text("description"),
    contactName: text("contactName"),
    contactEmail: text("contactEmail")?.toLowerCase() ?? null,
    contactPhone: text("contactPhone"),
    companyName: text("companyName"),
    companyEmail: text("companyEmail")?.toLowerCase() ?? null,
    companyPhone: text("companyPhone"),
    industry: text("industry"),
    userBaseSize: text("userBaseSize"),
    country: text("country")?.toUpperCase() ?? null,
    website: text("website"),
  };
  const errors: Record<string, string> = {};
  if (value.description && value.description.length > 1000) errors.description = "The description can be at most 1000 characters";
  if (value.contactName && value.contactName.length > 120) errors.contactName = "The contact name can be at most 120 characters";
  if (value.companyName && value.companyName.length > 160) errors.companyName = "The company name can be at most 160 characters";
  if (value.industry && value.industry.length > 80) errors.industry = "The industry can be at most 80 characters";
  if (value.contactEmail && !EMAIL.test(value.contactEmail)) errors.contactEmail = "The contact email is not a valid address";
  if (value.companyEmail && !EMAIL.test(value.companyEmail)) errors.companyEmail = "The company email is not a valid address";
  if (value.contactPhone && !PHONE.test(value.contactPhone)) errors.contactPhone = "The contact phone can hold digits, spaces, brackets, dashes and a leading +";
  if (value.companyPhone && !PHONE.test(value.companyPhone)) errors.companyPhone = "The company phone can hold digits, spaces, brackets, dashes and a leading +";
  if (value.userBaseSize && !(USER_BASE_SIZES as readonly string[]).includes(value.userBaseSize)) errors.userBaseSize = "Choose a user base size";
  if (value.country && !/^[A-Z]{2}$/.test(value.country)) errors.country = "Choose a country";
  if (value.website && !WEBSITE.test(value.website)) errors.website = "The website starts with https://";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
