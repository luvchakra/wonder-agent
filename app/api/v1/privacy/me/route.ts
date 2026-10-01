import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { errorResponse } from "@/lib/shared/apiError";
import { getPrivacyContacts, listConsentPurposes, listMyConsents, listMyRequests } from "@/modules/privacy/service";

/** The signed-in member's own privacy view: contacts, consent purposes, their consents and requests. */
export async function GET() {
  try {
    const ctx = await getTenantContext();
    if (!ctx.tenantId) return NextResponse.json({ ok: false, error: { code: "NO_TENANT" } }, { status: 401 });
    const [contacts, purposes, consents, requests] = await Promise.all([getPrivacyContacts(ctx.tenantId), listConsentPurposes(ctx.tenantId, true), listMyConsents(ctx.tenantId, ctx.userId), listMyRequests(ctx.tenantId, ctx.userId)]);
    return NextResponse.json({ ok: true, data: { contacts, purposes, consents, requests } });
  } catch (err) {
    return errorResponse(err);
  }
}
