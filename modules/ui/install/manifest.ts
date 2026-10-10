import type { MetadataRoute } from "next";
import { wonderIdBrand } from "../brand";

/** Where Next.js serves app/manifest.ts. */
export const MANIFEST_PATH = "/manifest.webmanifest";

/**
 * The origin the manifest was requested on, from the Host header and the
 * forwarded protocol, or null when either looks wrong. Each organization
 * address is its own origin, so the self-reference below must name the one
 * the browser is on.
 */
export function requestOrigin(host: string | null | undefined, forwardedProto: string | null | undefined): string | null {
  const h = host?.trim().toLowerCase();
  if (!h || !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/.test(h)) return null;
  const proto = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "http" || proto === "https" ? proto : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? "http" : "https";
  return `${scheme}://${h}`;
}

/**
 * EXPERIENCE-P0-26 — the web app manifest. Opens full screen at the home
 * page; the light theme's header and background colours; the brand icons.
 * `related_applications` lists this web app itself, so that
 * `navigator.getInstalledRelatedApps()` in a normal tab can tell the
 * install banner the app is already installed. No service worker: Chrome
 * no longer needs one to install, and the app does not work offline or
 * send push notifications, so nothing here claims either.
 */
export function buildManifest(origin: string | null): MetadataRoute.Manifest {
  const { app } = wonderIdBrand;
  return {
    id: "/",
    name: wonderIdBrand.name,
    short_name: wonderIdBrand.name,
    description: "Identity governance and security for human, machine and AI-agent identities",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: app.themeColor,
    background_color: app.backgroundColor,
    icons: [
      { src: app.icon192.src, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: app.icon512.src, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: app.maskable512.src, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    ...(origin ? { related_applications: [{ platform: "webapp", url: `${origin}${MANIFEST_PATH}` }] } : {}),
    prefer_related_applications: false,
  };
}
