import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getAiProviderConfig } from "@/modules/platform-admin/service";
import { getPlatformOpenAiApiKey } from "@/lib/db/env";
import { ApiError } from "@/lib/shared/types/foundation";
import { setAiProviderConfigAction } from "@/app/actions/ai";
import { Card, CardBody, CardHeader, StatusBadge } from "@/modules/ui";

// PLATFORM-P0-05.2 — bare functional admin page, gated by `ai.manage`.
// Not styled to the full UI-UX-DESIGN-RULES standard yet — Experience Agent
// restyles domain module pages per CLAUDE.md §13's "bare functional pages"
// allowance; this page reuses modules/ui/* primitives in the meantime.
export default async function AiProviderSettingsPage() {
  let ctx;
  try {
    ctx = await requirePermission("ai.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }

  const config = await getAiProviderConfig(ctx.tenantId!);
  const platformDefaultAvailable = getPlatformOpenAiApiKey() !== null;
  const activeSource = config?.useOwnKey && config.hasOwnKey ? "byok" : platformDefaultAvailable ? "platform" : "none";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">AI Provider</h1>
      <p className="text-sm text-muted-foreground">
        Powers the AI-Assisted Investigation summaries (findings, evidence bundles,
        SHOULD/CAN/DID comparisons, certification items). Summaries are advisory prose
        only — no authorization, risk, or remediation decision in WonderAgent ever
        depends on an AI output (non-negotiable #9). Currently OpenAI only.
      </p>

      <Card>
        <CardHeader title="Current status" />
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="text-muted-foreground">Active key source:</span>
            {activeSource === "byok" && <StatusBadge tone="success">Your own key (BYOK)</StatusBadge>}
            {activeSource === "platform" && <StatusBadge tone="info">Platform default</StatusBadge>}
            {activeSource === "none" && <StatusBadge tone="neutral">Not configured</StatusBadge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {platformDefaultAvailable
              ? "A platform-wide default key is available for tenants that don't bring their own."
              : "No platform-wide default key is configured for this deployment — bring your own key to enable AI summaries."}
          </p>
          {config && (
            <p className="text-xs text-muted-foreground">
              Model: {config.model} · Last updated {new Date(config.updatedAt).toLocaleString()}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Bring your own key" />
        <CardBody>
          <form action={setAiProviderConfigAction} className="space-y-3 max-w-md">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="useOwnKey" defaultChecked={config?.useOwnKey ?? false} />
              Use my own OpenAI API key instead of the platform default
            </label>
            <label className="block text-sm text-muted-foreground">
              OpenAI API key {config?.hasOwnKey && "(leave blank to keep the current key)"}
              <input
                type="password"
                name="apiKey"
                autoComplete="off"
                placeholder={config?.hasOwnKey ? "••••••••••••••••" : "sk-..."}
                className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground"
              />
            </label>
            <label className="block text-sm text-muted-foreground">
              Model
              <input
                name="model"
                defaultValue={config?.model ?? "gpt-4o-mini"}
                className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground"
              />
            </label>
            <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Save
            </button>
          </form>
        </CardBody>
      </Card>

      <p className="text-xs text-muted-foreground">
        Your key is encrypted at rest (lib/security/encryptSecret.ts, AES-256-GCM) and
        is never returned by any API response, logged, or visible to WonderAgent staff.
        Only a user with the ai.manage permission (TENANT_SUPER_ADMIN by default) can
        view this page or change this setting.
      </p>
    </div>
  );
}
