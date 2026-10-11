import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { ApiError } from "@/lib/shared/types/foundation";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { applyMemberInvitations, planMemberInvitations, type MemberRecord } from "@/lib/users/users";

/**
 * FOUNDATION-P0-32 — POST /api/v1/users/invitations: invite many people at
 * once. Body `{ invitations: [{ email, displayName, roles?, accountType?,
 * authMethod? }], dryRun?: boolean }`, at most 500.
 *
 * Each row is new (an invitation is sent), already a member (left as is,
 * so sending the same list again sends nothing twice) or invalid with the
 * reason, exactly as the users page's CSV import decides. `dryRun` returns
 * that plan and sends nothing. Roles need role management too, and only
 * roles whose permissions the caller holds can be given.
 *
 * Requires users.invite in the signed-in session's organization. An
 * automation credential for scripts comes with FOUNDATION-P0-31 (§8.2 of
 * the foundation design), which waits for decision D11.
 */
const MAX_ROWS = 500;

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("users.invite");
    const body = (await request.json().catch(() => null)) as { invitations?: unknown; dryRun?: unknown } | null;
    const list = Array.isArray(body?.invitations) ? body!.invitations : null;
    if (!list || list.length === 0) throw new ApiError(400, "VALIDATION_FAILED", "invitations: a list of { email, displayName, roles? }");
    if (list.length > MAX_ROWS) throw new ApiError(400, "VALIDATION_FAILED", `invitations: at most ${MAX_ROWS} at a time`);
    const records: MemberRecord[] = list.map((item, i) => {
      const v = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        row: i + 1,
        externalId: typeof v.email === "string" ? v.email.trim().toLowerCase() : `row-${i + 1}`,
        values: { email: v.email, displayName: v.displayName, roles: Array.isArray(v.roles) ? v.roles : typeof v.roles === "string" ? v.roles.split(",") : [], accountType: v.accountType, authMethod: v.authMethod },
      };
    });
    const { data: me } = await supabaseServiceRole().from("users").select("email").eq("id", ctx.userId).maybeSingle<{ email: string }>();
    const actor = { userId: ctx.userId, email: me?.email ?? null, permissions: ctx.permissions };
    if (body?.dryRun === true) {
      const rows = await planMemberInvitations(ctx.tenantId!, actor, records);
      const counts = { new: 0, unchanged: 0, invalid: 0 };
      for (const r of rows) if (r.decision === "new" || r.decision === "unchanged" || r.decision === "invalid") counts[r.decision]++;
      return NextResponse.json({ ok: true, data: { dryRun: true, counts, rows: rows.map((r) => ({ row: r.row, email: r.externalId, decision: r.decision, note: r.note })) } });
    }
    const rows = await applyMemberInvitations(ctx.tenantId!, actor, records);
    const counts = { invited: 0, unchanged: 0, skipped: 0, failed: 0 };
    for (const r of rows) counts[r.outcome === "created" ? "invited" : r.outcome === "unchanged" ? "unchanged" : r.outcome === "failed" ? "failed" : "skipped"]++;
    return NextResponse.json(
      { ok: true, data: { dryRun: false, counts, rows: rows.map((r) => ({ row: r.row, email: r.externalId, outcome: r.outcome === "created" ? "invited" : r.outcome, userId: r.targetId, message: r.message })) } },
      { status: counts.invited ? 201 : 200 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
