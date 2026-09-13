import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { supabaseServer } from "@/lib/db/supabaseServer";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    return NextResponse.json({ ok: false, error: { code: "NO_TENANT" } }, { status: 401 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, slug, status")
    .eq("id", ctx.tenantId)
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: error.message } },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, data });
}
