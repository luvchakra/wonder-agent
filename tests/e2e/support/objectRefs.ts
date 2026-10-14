import type { Page } from "@playwright/test";

/**
 * FOUNDATION-P0-34: object pages carry the object's number per organization,
 * never its UUID. These read the number from the page URL and, where a spec
 * needs the UUID (the API keeps UUIDs), look it up through the API as the
 * signed-in user.
 */

/** The number in the current page's URL after `prefix` (e.g. "/agents/"). */
export function refInUrl(page: Page, prefix: string): number {
  const segment = new URL(page.url()).pathname.split(prefix)[1]?.split("/")[0] ?? "";
  if (!/^\d+$/.test(segment)) throw new Error(`Expected a number after ${prefix} in ${page.url()}`);
  return Number(segment);
}

/** The UUID of the agent whose page is open (`/agents/<number>`). */
export async function agentIdOnPage(page: Page): Promise<string> {
  const ref = refInUrl(page, "/agents/");
  const res = await page.request.get("/api/v1/agents");
  if (!res.ok()) throw new Error(`GET /api/v1/agents: ${res.status()}`);
  const agent = ((await res.json()).data as { id: string; ref: number | null }[]).find((a) => a.ref === ref);
  if (!agent) throw new Error(`No agent numbered ${ref}`);
  return agent.id;
}
