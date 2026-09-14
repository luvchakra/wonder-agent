import { NextResponse } from "next/server";
import { ingestMcpRuntimeEvent } from "@/modules/integrations/service";

/**
 * INTEGRATION-P0-04.2 (higher bar). Machine-to-machine endpoint — no user
 * session, authenticated only by the integration's shared secret as a
 * bearer token (see modules/integrations/mcpEvents.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  let event;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT" } }, { status: 400 });
  }

  const result = await ingestMcpRuntimeEvent(id, bearerToken, event);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: { code: "REJECTED", message: result.reason } }, { status: result.status });
  }
  return NextResponse.json({ ok: true, data: null }, { status: 202 });
}
