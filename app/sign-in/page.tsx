import type { Metadata } from "next";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { brandTitle } from "@/modules/ui/brand";
import { SignInFormBoundary } from "./SignInForm";

// FOUNDATION-P0-22 — on an organization's own address
// (`<slug>.<BASE_APP_HOST>`) the sign-in page is that organization's:
// its name, no organization picker, no sign-up, and a clear message when it
// is suspended. Elsewhere it is the general WonderID sign-in. The address
// only names the organization; signInAction() still refuses a suspended
// organization, and access still needs an active membership.
// §16: "ACME · Sign in · WonderID" on an organization's address.
export async function generateMetadata(): Promise<Metadata> {
  const host = await getHostTenant();
  return { title: { absolute: host.tenant ? brandTitle("Sign in", host.tenant.name) : brandTitle("Sign in") } };
}

export default async function SignInPage() {
  const host = await getHostTenant();
  const tenant = host.tenant ? { name: host.tenant.name, suspended: host.tenant.status !== "active" } : null;
  return <SignInFormBoundary tenant={tenant} />;
}
