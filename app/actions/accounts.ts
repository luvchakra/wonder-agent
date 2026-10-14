"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { linkAccount, reconcileApplicationAccess, reconcileApplicationAccounts, type AccessReconciliationRun } from "@/modules/access-governance/service";

/**
 * ACCESS-P0-17 — account inventory forms. The real result or error is
 * returned (§17.5); the tenant comes from the session (#2).
 */
export type AccountFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function formError(err: unknown): AccountFormState {
  const e = err as { message?: string; code?: string };
  return { status: "error", message: e?.message || e?.code || "Something went wrong" };
}

export async function linkAccountAction(accountId: string, _prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const ctx = await requirePermission("access.manage");
  const unlink = formData.get("intent") === "unlink";
  try {
    const a = await linkAccount(ctx.tenantId!, ctx.userId, accountId, unlink ? null : String(formData.get("identityId") ?? ""));
    revalidatePath("/(customer)/access/accounts/[id]", "page");
    revalidatePath("/access/accounts");
    return { status: "saved", message: a.identityId ? `Linked to ${a.identityName ?? "the identity"}.` : "Unlinked. The account is an orphan." };
  } catch (err) {
    return formError(err);
  }
}

export async function reconcileAccountsAction(applicationId: string, prev: AccountFormState): Promise<AccountFormState> {
  void prev;
  const ctx = await requirePermission("access.manage");
  try {
    const run = await reconcileApplicationAccounts(ctx.tenantId!, ctx.userId, applicationId);
    revalidatePath("/(customer)/access/applications/[id]", "page");
    revalidatePath("/access/accounts");
    return {
      status: "saved",
      message: `Reconciled ${run.sourceAccounts} source account(s): ${run.created} new, ${run.correlated} matched, ${run.orphan} orphan, ${run.ambiguous} ambiguous${run.notInSource ? `, ${run.notInSource} missing from the source` : ""}.`,
    };
  } catch (err) {
    return formError(err);
  }
}

/**
 * ACCESS-P0-27 — entitlements and access from the connector: a preview
 * first (changes nothing), then an apply of exactly that preview, refused
 * if the source or the records changed in between.
 */
export type AccessReconcileState =
  | { status: "idle" }
  | { status: "previewed"; run: AccessReconciliationRun }
  | { status: "applied"; run: AccessReconciliationRun }
  | { status: "error"; message: string };

export async function reconcileAccessAction(applicationId: string, _prev: AccessReconcileState, formData: FormData): Promise<AccessReconcileState> {
  const ctx = await requirePermission("access.manage");
  const previewRunId = String(formData.get("previewRunId") ?? "") || null;
  try {
    if (!previewRunId) {
      return { status: "previewed", run: await reconcileApplicationAccess(ctx.tenantId!, ctx.userId, applicationId, { dryRun: true }) };
    }
    const run = await reconcileApplicationAccess(ctx.tenantId!, ctx.userId, applicationId, { dryRun: false, previewRunId });
    revalidatePath("/(customer)/access/applications/[id]", "page");
    return { status: "applied", run };
  } catch (err) {
    const e = err as { message?: string; code?: string };
    return { status: "error", message: e?.message || e?.code || "Something went wrong" };
  }
}
