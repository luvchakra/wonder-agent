import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { completeLifecycleTask, transferOwnership } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// Closes a lifecycle task: { action: "transfer", toIdentityId } carries out
// an ownership transfer; { action: "done" | "skipped", note } records work
// done elsewhere (skipping needs a note).
export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { taskId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    if (body.action === "transfer") {
      return NextResponse.json({ ok: true, data: await transferOwnership(ctx.tenantId!, ctx.userId, taskId, String(body.toIdentityId ?? "")) });
    }
    await completeLifecycleTask(ctx.tenantId!, ctx.userId, taskId, { status: body.action, note: body.note });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
