import { getBranding, listConfigVersions } from "@/modules/platform-admin/service";
import { updateBrandingAction, rollbackConfigVersionAction } from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformBrandingPage() {
  const [branding, versions] = await Promise.all([getBranding(), listConfigVersions("branding", null)]);
  const rollbackWithPath = rollbackConfigVersionAction.bind(null, "/platform-admin/branding");

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

      <h2>Version history (PLATFORM-P0-05.3)</h2>
      {versions.length === 0 && <p>No changes recorded yet.</p>}
      <ul>
        {versions.map((v) => (
          <li key={v.id} style={{ marginBottom: "0.5rem" }}>
            {v.createdAt} — <code>{JSON.stringify(v.newValue)}</code>
            <form action={rollbackWithPath} style={{ display: "inline", marginLeft: "0.5rem" }}>
              <input type="hidden" name="versionId" value={v.id} />
              <button type="submit">Roll back to before this change</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
