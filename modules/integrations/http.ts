import "server-only";

import { NextResponse } from "next/server";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * Small local helper shared by this module's own API routes only — mirrors
 * modules/agent-identity/http.ts's pattern.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  throw err;
}
