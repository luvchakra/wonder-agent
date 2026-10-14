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
export function buildManifest(origin: string | null, baseHost: string | null = null): MetadataRoute.Manifest {
  const { app } = wonderIdBrand;
  // Owner request 2026-10-14: one installed app for every organization and
  // environment. Each organization address is its own origin, and an
  // installed app stays on the origin it came from, so switching opened the
  // browser instead. The app is installed from the main address and its
  // scope extends to every <slug>.<base> address (each one opts in through
  // /.well-known/web-app-origin-association). An organization address is
  // then not installable on its own (display "browser"): an app installed
  // there could never switch.
  const site = siteOf(origin, baseHost);
  return {
    id: "/",
    name: wonderIdBrand.name,
    short_name: wonderIdBrand.name,
    description: "Identity governance and security for human, machine and AI-agent identities",
    lang: "en",
    start_url: site?.kind === "main" ? "/organizations" : "/",
    scope: "/",
    display: site?.kind === "organization" ? "browser" : "standalone",
    ...(site?.kind === "main" ? { scope_extensions: [{ type: "origin", origin: `${site.scheme}://*.${baseHost}${site.port}` }] } : {}),
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

/** Whether this origin is the main address or an organization address under it (null when tenant addresses are off). */
export function siteOf(origin: string | null, baseHost: string | null): { kind: "main" | "organization"; scheme: string; port: string } | null {
  if (!origin || !baseHost) return null;
  const m = /^(https?):\/\/([^/:]+)(:\d+)?$/.exec(origin);
  if (!m) return null;
  const port = m[3] ?? "";
  if (m[2] === baseHost) return { kind: "main", scheme: m[1], port };
  if (m[2].endsWith(`.${baseHost}`)) return { kind: "organization", scheme: m[1], port };
  return null;
}

/**
 * The opt-in each organization address publishes at
 * /.well-known/web-app-origin-association: only the one app installed from
 * the main address may extend into it. A constant per deployment, so it
 * names no organization.
 */
export function originAssociation(origin: string | null, baseHost: string | null): Record<string, { scope: string }> {
  const site = siteOf(origin, baseHost);
  if (!site) return {};
  return { [`${site.scheme}://${baseHost}${site.port}/`]: { scope: "/" } };
}
