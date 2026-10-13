// The title for an address that names no organization. It lives here, not on
// page.tsx: a page's metadata is not applied once it calls notFound().
export const metadata = { title: "Organization not found" };

export default function TenantNotFoundLayout({ children }: { children: React.ReactNode }) {
  return children;
}
