import { NextResponse } from "next/server";
import { bearerAgentKey, verifyAgentApiKey } from "@/lib/security/agentApiKeys";
import { filterGatewayTools } from "@/modules/runtime-assurance/service";
import { ApiError } from "@/lib/shared/types/foundation";

// RUNTIME-P0-18 — POST /api/gateway/v1/tools/filter. An agent asks which of
// its tools it may be shown. Authenticated by agent API key, like
// /authorize; no user session.

const MAX_BODY_BYTES = 16 * 1024;

function error(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let principal;
  try {
    principal = await verifyAgentApiKey(bearerAgentKey(request.headers));
  } catch {
    return error(503, "AUTH_UNAVAILABLE", "Agent authentication is temporarily unavailable");
  }
  if (!principal) return error(401, "UNAUTHENTICATED", "A valid agent API key is required");

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return error(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 16 KB");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return error(400, "VALIDATION_FAILED", "body: must be valid JSON");
  }
  try {
    const data = await filterGatewayTools(principal, body);
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ApiError) return error(err.status, err.code, err.message);
    console.error("gateway tool filter failed", err);
    return error(500, "INTERNAL_ERROR", "Tool visibility could not be evaluated");
  }
}
