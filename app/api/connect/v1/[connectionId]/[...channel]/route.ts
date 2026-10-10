import { NextResponse } from "next/server";
import { receive } from "@/modules/integrations/framework/receive";

/**
 * The receiving side of the connector framework (non-negotiable #20): the
 * only route through which an organization's systems send WonderID data.
 *
 *   POST /api/connect/v1/<connection id>/events                 runtime events (connection secret)
 *   POST /api/connect/v1/<connection id>/webhook                any signed event (connection secret)
 *   POST /api/connect/v1/<connection id>/gateway/authorize      Runtime Gateway (agent API key)
 *   POST /api/connect/v1/<connection id>/gateway/tools/filter   Runtime Gateway (agent API key)
 *
 * No user session is read (proxy.ts skips /api/connect/). The body is read
 * as raw text so a signature is checked over the exact bytes sent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string; channel: string[] }> }) {
  const { connectionId, channel } = await params;
  const result = await receive(connectionId, channel.join("/"), await request.text(), request.headers);
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
