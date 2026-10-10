import { permanentRedirect } from "next/navigation";

/** The old connect form, now under its connection type. Kept so old links still work. */
export default async function ConnectRedirect({ params }: { params: Promise<{ origin: string; key: string }> }) {
  const { origin, key } = await params;
  permanentRedirect(`/integrations/types/${encodeURIComponent(origin)}/${encodeURIComponent(key)}/connect`);
}
