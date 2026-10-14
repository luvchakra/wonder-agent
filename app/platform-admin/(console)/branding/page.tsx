import { getBranding, listConfigVersions } from "@/modules/platform-admin/service";
import { updateBrandingAction, rollbackConfigVersionAction } from "@/app/actions/platform";
import { Button, Card, CardBody, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { PageHeading } from "@/app/platform-admin/PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformBrandingPage() {
  const [branding, versions] = await Promise.all([getBranding(), listConfigVersions("branding", null)]);
  const rollbackWithPath = rollbackConfigVersionAction.bind(null, "/platform-admin/branding");

  return (
    <>
      <PageHeading title="Global Configuration" description="Product-wide settings for every organization." />
      <Card>
        <CardBody>
          <form action={updateBrandingAction} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="productName" className={fieldLabelClass}>
                Product name
              </label>
              <input id="productName" name="productName" defaultValue={branding.productName} className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="defaultTheme" className={fieldLabelClass}>
                Default theme
              </label>
              <select id="defaultTheme" name="defaultTheme" defaultValue={branding.defaultTheme} className={fieldInputClass}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
            <div>
              <label htmlFor="supportUrl" className={fieldLabelClass}>
                Support URL
              </label>
              <input id="supportUrl" name="supportUrl" type="url" defaultValue={branding.supportUrl ?? ""} className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="docsUrl" className={fieldLabelClass}>
                Docs URL
              </label>
              <input id="docsUrl" name="docsUrl" type="url" defaultValue={branding.docsUrl ?? ""} className={fieldInputClass} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* PLATFORM-P0-05.3 — versioned, with rollback. */}
      <details className="group rounded-xl border border-border/60 bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-card-foreground">Version history ({versions.length})</summary>
        {versions.length === 0 ? (
          <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
                  <code className="block truncate text-xs text-foreground">{JSON.stringify(v.newValue)}</code>
                </div>
                <form action={rollbackWithPath}>
                  <input type="hidden" name="versionId" value={v.id} />
                  <Button type="submit" size="sm" variant="outline">
                    Roll back to before this change
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
