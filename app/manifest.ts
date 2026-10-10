import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { buildManifest, requestOrigin } from "@/modules/ui/install/manifest";

// EXPERIENCE-P0-26 — /manifest.webmanifest. Read per request because the
// related_applications self-reference must be absolute and each
// organization address is its own origin. It holds no tenant or user data,
// and proxy.ts lets it through without a session: browsers fetch the
// manifest without cookies.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const h = await headers();
  return buildManifest(requestOrigin(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto")));
}
