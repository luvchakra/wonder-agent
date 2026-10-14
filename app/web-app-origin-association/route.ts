import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { baseAppHost } from "@/lib/tenant/host";
import { originAssociation, requestOrigin } from "@/modules/ui/install/manifest";

/**
 * Served at /.well-known/web-app-origin-association (rewrite in
 * next.config.ts). Lets the one installed WonderID app (from the main
 * address) open this organization address inside its window. Public by
 * design, like the manifest: browsers fetch it without cookies. It names
 * only the main address's app, never an organization.
 */
export async function GET() {
  const h = await headers();
  const body = originAssociation(requestOrigin(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto")), baseAppHost());
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
