import { NextRequest, NextResponse } from "next/server";
import { findActiveSsoConnectionForDomain } from "@/lib/auth/sso";

/**
 * Deliberately unauthenticated (called from the sign-in page before login)
 * so the UI can offer an "SSO" option for a given email domain. Returns only
 * {domain, protocol} — never idp_metadata/claims_mapping — and matching a
 * domain here never grants access on its own; it only picks which sign-in
 * flow to start (CLAUDE.md non-negotiable #2).
 */
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain")?.trim().toLowerCase();
  if (!domain) {
    return NextResponse.json({ ok: false, error: { code: "MISSING_DOMAIN" } }, { status: 400 });
  }
  const connection = await findActiveSsoConnectionForDomain(domain);
  return NextResponse.json({ ok: true, data: connection });
}
