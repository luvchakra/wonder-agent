import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listHumanLifecycleEvents, listLifecycleTasks, transitionHumanLifecycle } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { HUMAN_LIFECYCLE_STATES, type HumanLifecycleState } from "@/lib/shared/types/agent-identity";

// IDENTITY-P0-18 — a person's lifecycle: history and open work (GET), and a
// governed transition (POST { toState, note }).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("identity.read");
    const { id } = await params;
    const [events, tasks] = await Promise.all([listHumanLifecycleEvents(ctx.tenantId!, id), listLifecycleTasks(ctx.tenantId!, { identityId: id })]);
    return NextResponse.json({ ok: true, data: { events, tasks } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    if (!(HUMAN_LIFECYCLE_STATES as readonly string[]).includes(body.toState)) {
      return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: `toState: one of ${HUMAN_LIFECYCLE_STATES.join(", ")}` } }, { status: 400 });
    }
    const event = await transitionHumanLifecycle(ctx.tenantId!, ctx.userId, id, body.toState as HumanLifecycleState, typeof body.note === "string" ? body.note : null);
    return NextResponse.json({ ok: true, data: event }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
