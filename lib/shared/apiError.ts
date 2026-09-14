import "server-only";

import { NextResponse } from "next/server";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * Shared API-route error helper. Converts an ApiError thrown by
 * requirePermission()/requirePlatformAdmin() or a Foundation service
 * function into a consistent JSON error response; rethrows anything else so
 * it surfaces as a 500 with a real stack trace instead of being swallowed.
 * Domain modules may keep their own local copy (e.g.
 * modules/agent-identity/http.ts) — this is the version other Foundation-
 * owned routes (sso, roles) use, published here so a future route doesn't
 * have to re-inline the same three lines again.
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
