import { NextResponse } from "next/server";
import { bearerAgentKey, verifyAgentApiKey } from "@/lib/security/agentApiKeys";
import { authorizeRuntimeRequest, parseGatewayRequest } from "@/modules/runtime-assurance/service";
import { ApiError } from "@/lib/shared/types/foundation";

// RUNTIME-P0-15 — POST /api/gateway/v1/authorize. Called by an AI agent
// before it acts, with `Authorization: Bearer <agent API key>`. No user
// session is read here (proxy.ts skips this subtree). The key alone
// identifies the tenant and the agent.

const MAX_BODY_BYTES = 16 * 1024;

function error(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // Authenticate first: nothing about an unauthenticated request is read,
  // stored or echoed back.
  let principal;
  try {
    principal = await verifyAgentApiKey(bearerAgentKey(request.headers));
  } catch {
    // The key store could not be reached. That is never permission.
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
    const decision = await authorizeRuntimeRequest(principal, parseGatewayRequest(body));
    return NextResponse.json({ ok: true, data: decision }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ApiError) return error(err.status, err.code, err.message);
    console.error("gateway authorize failed", err);
    return error(500, "INTERNAL_ERROR", "The request could not be decided");
  }
}
