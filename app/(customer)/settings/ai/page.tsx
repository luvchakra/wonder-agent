import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getAiProviderConfig } from "@/modules/platform-admin/service";
import { getPlatformOpenAiApiKey, getPlatformGeminiApiKey } from "@/lib/db/env";
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
  const provider = config?.provider ?? "openai";
  const platformDefaultAvailable = provider === "gemini" ? getPlatformGeminiApiKey() !== null : getPlatformOpenAiApiKey() !== null;
  const activeSource = config?.useOwnKey && config.hasOwnKey ? "byok" : platformDefaultAvailable ? "platform" : "none";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">AI Provider</h1>
      <p className="text-sm text-muted-foreground">
        Powers the AI-Assisted Investigation summaries (findings, evidence bundles,
        Approved (SHOULD) / Effective Access (CAN) / Observed (DID) comparisons, certification items). Summaries are advisory prose
        only — no authorization, risk, or remediation decision in WonderAgent ever
        depends on an AI output (non-negotiable #9). Supports OpenAI and Google Gemini.
      </p>

      <Card>
        <CardHeader title="Current status" />
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="text-muted-foreground">Provider:</span>
            <StatusBadge tone="neutral">{provider === "gemini" ? "Google Gemini" : "OpenAI"}</StatusBadge>
            <span className="text-muted-foreground">Active key source:</span>
            {activeSource === "byok" && <StatusBadge tone="success">Your own key (BYOK)</StatusBadge>}
            {activeSource === "platform" && <StatusBadge tone="info">Platform default</StatusBadge>}
            {activeSource === "none" && <StatusBadge tone="neutral">Not configured</StatusBadge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {platformDefaultAvailable
              ? "A platform-wide default key is available for tenants that don't bring their own."
              : "No platform-wide default key is configured for this deployment. Bring your own key below, or — if you're the platform operator — set PLATFORM_OPENAI_API_KEY or PLATFORM_GEMINI_API_KEY as a deployment environment variable; there is no Platform Admin page for this setting yet."}
          </p>
          {config && (
            <p className="text-xs text-muted-foreground">
              Model: {config.model} · Last updated {new Date(config.updatedAt).toLocaleString()}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Provider & bring your own key" />
        <CardBody>
          <form action={setAiProviderConfigAction} className="space-y-3 max-w-md">
            <label className="block text-sm text-muted-foreground">
              Provider
              <select name="provider" defaultValue={provider} className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground">
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="useOwnKey" defaultChecked={config?.useOwnKey ?? false} />
              Use my own API key instead of the platform default
            </label>
            <label className="block text-sm text-muted-foreground">
              API key {config?.hasOwnKey && "(leave blank to keep the current key for the selected provider)"}
              <input
                type="password"
                name="apiKey"
                autoComplete="off"
                placeholder={config?.hasOwnKey ? "••••••••••••••••" : "sk-... or AIza..."}
                className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Required whenever the selected provider differs from the one currently
                configured, or if no key is stored yet.
              </span>
            </label>
            <label className="block text-sm text-muted-foreground">
              Model
              <input
                name="model"
                defaultValue={config?.model ?? (provider === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini")}
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
        view this page or change this setting. Switching provider never reuses a
        previously stored key for a different provider — you must supply a fresh key
        for BYOK after switching.
      </p>
    </div>
  );
}
