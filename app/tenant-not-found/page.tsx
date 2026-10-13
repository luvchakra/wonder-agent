import { notFound } from "next/navigation";

// FOUNDATION-P0-22 — an address under the WonderID domain that names no
// organization (or a malformed one). The proxy rewrites every path there to
// this page, keeping the URL. It says nothing about which organizations
// exist.
//
// The 404 comes from notFound() here, not from the rewrite's status: Vercel's
// build serves a rewritten page with 200 whatever status the proxy set (the
// tenant-address E2E failed that way only there). not-found.tsx beside this
// page renders the message; layout.tsx sets the title.
export default function TenantNotFoundPage() {
  notFound();
}
