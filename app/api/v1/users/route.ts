import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";

export async function GET() {
  try {
    await requirePermission("user.manage");
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: err.status },
      );
    }
    throw err;
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("user_id, status, users(email, display_name)")
    .eq("status", "active");

  if (error) {
    return NextResponse.json(
      { ok: false, error: { code: "QUERY_FAILED", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, data });
}
