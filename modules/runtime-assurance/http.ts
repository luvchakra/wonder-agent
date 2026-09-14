import "server-only";

import { NextResponse } from "next/server";
import { ApiError } from "@/lib/shared/types/foundation";

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  throw err;
}
