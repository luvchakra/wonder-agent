import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Non-negotiable #20: an organization's systems reach WonderID only through
 * a connection's receiving side. Specs that send agent activity or call
 * the Runtime Gateway first open such a connection, signed in as an
 * administrator of the organization, exactly as a customer would.
 */
export type ReceivingConnection = {
  id: string;
  /** The connection's receiving secret. */
  secret: string;
  events: string;
  webhook: string;
  authorize: string;
  toolsFilter: string;
};

export async function openConnection(
  admin: APIRequestContext,
  key: "runtime-gateway" | "webhook" | "mcp-server",
  name: string,
  settings: Record<string, string> = {},
): Promise<ReceivingConnection> {
  const res = await admin.post("/api/v1/integrations/connectors/connect", { data: { origin: "builtin", key, name, settings } });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).data.integration.id as string;
  // Every one of these definitions receives something that needs a secret.
  const s = await admin.post(`/api/v1/integrations/${id}/receiver-secret`);
  expect(s.status(), await s.text()).toBe(201);
  const secret = (await s.json()).data.secret as string;
  const base = `/api/connect/v1/${id}`;
  return { id, secret, events: `${base}/events`, webhook: `${base}/webhook`, authorize: `${base}/gateway/authorize`, toolsFilter: `${base}/gateway/tools/filter` };
}

/** Sends agent activity the way a runtime does: the connection secret as a bearer token. */
export function sendEvents(sender: APIRequestContext, conn: ReceivingConnection, body: unknown) {
  return sender.post(conn.events, { headers: { authorization: `Bearer ${conn.secret}`, "content-type": "application/json" }, data: body });
}
