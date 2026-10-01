import type { NextConfig } from "next";

// FOUNDATION-P0-05.3 — baseline HTTP security headers. A CSP baseline that
// still allows Supabase Auth's SSO redirects and Next.js's own inline
// runtime bootstrap script; frame-ancestors 'none' blocks this app from
// ever being iframed (no legitimate reason to embed WonderAgent).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // FOUNDATION-P0-30 — IT security hardening (2026-10-01): HTTPS only for
  // two years including tenant subdomains (preload-eligible); the window
  // is isolated from cross-origin openers; this app's responses are not
  // embeddable by other sites; no DNS prefetch leakage; and powerful
  // browser features are off. Payment needs no Payment Request API since
  // checkout is on the provider's hosted page.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), interest-cohort=(), browsing-topics=()" },
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
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      // PLATFORM-P1-04: a checkout form's redirect lands on the provider's
      // hosted page (Stripe Checkout / Billing Portal, Razorpay's link).
      "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://rzp.io https://api.razorpay.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework in every response.
  poweredByHeader: false,
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
