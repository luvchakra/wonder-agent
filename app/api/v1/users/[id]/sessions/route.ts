import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { listUserSessions, revokeUserSessions } from "@/lib/users/users";

// FOUNDATION-P0-23 — GET lists a member's live sessions (browser and
// times, no IP address); DELETE ends them all.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("users.view");
    return NextResponse.json({ ok: true, data: await listUserSessions(ctx.tenantId!, (await params).id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("users.suspend");
    const ended = await revokeUserSessions(ctx.tenantId!, ctx.userId, (await params).id);
    return NextResponse.json({ ok: true, data: { sessionsEnded: ended } });
  } catch (err) {
    return errorResponse(err);
  }
}
