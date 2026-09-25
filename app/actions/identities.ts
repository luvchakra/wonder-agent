"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  addIdentityRelationship,
  createAttributeDefinition,
  createIdentity,
  endIdentityRelationship,
  setAttributeDefinitionActive,
  updateIdentity,
} from "@/modules/agent-identity/service";

/**
 * IDENTITY-P0-15/16/17 — the identity directory's forms. Each returns the
 * real result or the real error for the form to show (§17.5); creating an
 * identity redirects to it only once it exists. The tenant always comes
 * from the session (#2).
 */
export type IdentityFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function formError(err: unknown): IdentityFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

const IDENTITY_FIELDS = [
  "subtype",
  "displayName",
  "username",
  "email",
  "status",
  "ownerIdentityId",
  "sponsorIdentityId",
  "managerIdentityId",
  "department",
  "title",
  "businessUnit",
  "location",
  "employmentType",
  "organization",
  "purpose",
  "startDate",
  "endDate",
] as const;

/** Only the fields the form rendered are sent, so absent ones keep their value. */
function identityFields(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of IDENTITY_FIELDS) if (formData.has(key)) out[key] = String(formData.get(key) ?? "");
  if (formData.has("privilegedPresent")) out.privileged = formData.get("privileged") === "on";
  // Attribute inputs are named attr.<name>; the form marks that it rendered them.
  if (formData.has("attributesPresent")) {
    const attributes: Record<string, string> = {};
    for (const [key, value] of formData.entries()) if (key.startsWith("attr.")) attributes[key.slice(5)] = String(value);
    out.attributes = attributes;
  }
  return out;
}

export async function createIdentityAction(_prev: IdentityFormState, formData: FormData): Promise<IdentityFormState> {
  const ctx = await requirePermission("identity.manage");
  let id: string;
  try {
    const identity = await createIdentity(ctx.tenantId!, ctx.userId, {
      identityType: String(formData.get("identityType") ?? ""),
      ...identityFields(formData),
    });
    id = identity.id;
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/identities");
  redirect(`/identities/${id}`);
}

export async function updateIdentityAction(identityId: string, _prev: IdentityFormState, formData: FormData): Promise<IdentityFormState> {
  const ctx = await requirePermission("identity.manage");
  try {
    await updateIdentity(ctx.tenantId!, ctx.userId, identityId, identityFields(formData));
  } catch (err) {
    return formError(err);
  }
  revalidatePath(`/identities/${identityId}`);
  return { status: "saved", message: "Saved." };
}

export async function addRelationshipAction(identityId: string, _prev: IdentityFormState, formData: FormData): Promise<IdentityFormState> {
  const ctx = await requirePermission("identity.manage");
  try {
    // "Incoming" puts the chosen identity at the source end (e.g. their manager_of this one).
    const other = String(formData.get("otherIdentityId") ?? "");
    const incoming = formData.get("direction") === "incoming";
    await addIdentityRelationship(ctx.tenantId!, ctx.userId, {
      sourceIdentityId: incoming ? other : identityId,
      targetIdentityId: incoming ? identityId : other,
      relationshipType: String(formData.get("relationshipType") ?? ""),
      validTo: String(formData.get("validTo") ?? "") || undefined,
    });
  } catch (err) {
    return formError(err);
  }
  revalidatePath(`/identities/${identityId}`);
  return { status: "saved", message: "Relationship added." };
}

export async function endRelationshipAction(identityId: string, relationshipId: string): Promise<IdentityFormState> {
  const ctx = await requirePermission("identity.manage");
  try {
    await endIdentityRelationship(ctx.tenantId!, ctx.userId, relationshipId);
  } catch (err) {
    return formError(err);
  }
  revalidatePath(`/identities/${identityId}`);
  return { status: "saved", message: "Relationship ended." };
}

export async function createAttributeDefinitionAction(_prev: IdentityFormState, formData: FormData): Promise<IdentityFormState> {
  const ctx = await requirePermission("identity.manage");
  try {
    const d = await createAttributeDefinition(ctx.tenantId!, ctx.userId, {
      identityType: String(formData.get("identityType") ?? ""),
      name: String(formData.get("name") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      dataType: String(formData.get("dataType") ?? ""),
      required: formData.get("required") === "on",
      sensitive: formData.get("sensitive") === "on",
      searchable: formData.get("searchable") === "on",
      uniqueValue: formData.get("uniqueValue") === "on",
      allowedValues: String(formData.get("allowedValues") ?? ""),
      validationRegex: String(formData.get("validationRegex") ?? ""),
    });
    revalidatePath("/identities/attributes");
    return { status: "saved", message: `Attribute ${d.displayName} added.` };
  } catch (err) {
    return formError(err);
  }
}

export async function setAttributeActiveAction(definitionId: string, active: boolean): Promise<IdentityFormState> {
  const ctx = await requirePermission("identity.manage");
  try {
    await setAttributeDefinitionActive(ctx.tenantId!, ctx.userId, definitionId, active);
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/identities/attributes");
  return { status: "saved", message: active ? "Restored." : "Retired." };
}
