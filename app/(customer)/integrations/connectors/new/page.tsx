import { permanentRedirect } from "next/navigation";

/** Writing a connector is now writing a connection type. Kept so old links (with `?from=`) still work. */
export default async function NewConnectorRedirect({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  permanentRedirect(from ? `/integrations/types/new?from=${encodeURIComponent(from)}` : "/integrations/types/new");
}
