import "server-only";

import { NextResponse } from "next/server";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * Small local helper shared by this module's own API routes only — not a
 * shared/foundation contract. Converts any ApiError thrown by
 * requirePermission() or this module's service functions into a consistent
 * JSON error response; rethrows anything else so it surfaces as a 500 with a
 * real stack trace instead of being swallowed.
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
