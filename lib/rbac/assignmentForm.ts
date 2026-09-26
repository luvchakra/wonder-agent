import { validateTerms } from "./assignmentRules";

/** FOUNDATION-P0-19 — an assignment's terms from a form (AssignmentTermsFields). */
export function termsFromForm(formData: FormData, role: string) {
  return validateTerms(
    {
      scopeType: formData.get("scopeType") ?? "tenant",
      scopeValues: formData.getAll("scopeValues"),
      startsAt: formData.get("startsAt"),
      expiresAt: formData.get("expiresAt"),
      requiresMfa: formData.get("requiresMfa"),
    },
    role,
    new Date(),
  );
}
