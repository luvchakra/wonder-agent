import type { NextConfig } from "next";

// FOUNDATION-P0-05.3 — baseline HTTP security headers. A CSP baseline that
// still allows Supabase Auth's SSO redirects and Next.js's own inline
// runtime bootstrap script; frame-ancestors 'none' blocks this app from
// ever being iframed (no legitimate reason to embed WonderAgent).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  experimental: {
    // Keep a visited dynamic route's payload in the client router cache
    // for 30s, so Back/Forward and re-clicking a nav item paint instantly
    // from memory instead of re-rendering on the server. Thirty seconds is
    // short enough that governance data — findings, lifecycle states —
    // never reads stale for long; every mutation goes through a server
    // action that revalidates anyway.
    staleTimes: { dynamic: 30, static: 180 },
    // Tree-shake these at the import site instead of pulling their whole
    // barrel into every chunk that touches one icon or one chart type.
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
