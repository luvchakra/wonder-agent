import { getBranding } from "@/modules/platform-admin/service";
import { updateBrandingAction } from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformBrandingPage() {
  const branding = await getBranding();

  return (
    <main>
      <h1>Global Configuration</h1>
      <form action={updateBrandingAction}>
        <p>
          Product name: <input name="productName" defaultValue={branding.productName} />
        </p>
        <p>
          Support URL: <input name="supportUrl" defaultValue={branding.supportUrl ?? ""} />
        </p>
        <p>
          Docs URL: <input name="docsUrl" defaultValue={branding.docsUrl ?? ""} />
        </p>
        <p>
          Default theme:{" "}
          <select name="defaultTheme" defaultValue={branding.defaultTheme}>
            <option value="light">light</option>
            <option value="dark">dark</option>
            <option value="system">system</option>
          </select>
        </p>
        <button type="submit">Save</button>
      </form>
    </main>
  );
}
