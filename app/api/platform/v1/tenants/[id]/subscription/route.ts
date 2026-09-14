import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { createSubscription, getSubscription, updateSubscriptionStatus } from "@/modules/platform-admin/service";
import { errorResponse } from "@/modules/platform-admin/http";
import type { SubscriptionPlan } from "@/lib/shared/types/platform";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const subscription = await getSubscription(id);
    return NextResponse.json({ ok: true, data: subscription });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const body = await request.json();
    const subscription = await createSubscription(userId, id, body.plan as SubscriptionPlan);
    return NextResponse.json({ ok: true, data: subscription });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const body = await request.json();
    const existing = await getSubscription(id);
    if (!existing) return NextResponse.json({ ok: false, error: { code: "SUBSCRIPTION_NOT_FOUND" } }, { status: 404 });
    const subscription = await updateSubscriptionStatus(userId, existing.id, body.status);
    return NextResponse.json({ ok: true, data: subscription });
  } catch (err) {
    return errorResponse(err);
  }
}
