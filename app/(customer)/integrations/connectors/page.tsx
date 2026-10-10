import { permanentRedirect } from "next/navigation";

/** The connector catalog is now Connection types. Kept so old links still work. */
export default function ConnectorCatalogRedirect() {
  permanentRedirect("/integrations/types");
}
