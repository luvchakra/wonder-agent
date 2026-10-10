// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { createDefinitionConnector } from "./connector";
import { openGateway } from "../gateway/gateway";
import { RESOURCE_KINDS } from "./types";

/**
 * Contract test against real systems, skipped unless CONNECTOR_LIVE_FILE
 * names a connections file (the demo kit writes one:
 * demo-org/generated/wonderid-connections.json). For each connection it
 * tests the connection and imports every resource through the production
 * engine and outbound guard. A system integrator certifies a connector the
 * same way against their own system.
 *
 *   CONNECTOR_LIVE_FILE=… OUTBOUND_ALLOW_PRIVATE_NETWORKS=true npx vitest run modules/integrations/framework/live.test.ts
 */
type Connection = { system: string; connector: string; settings: Record<string, unknown>; secret: Record<string, string> };
const file = process.env.CONNECTOR_LIVE_FILE;
const only = process.env.CONNECTOR_LIVE_ONLY?.split(",");
const connections: Connection[] = file ? JSON.parse(readFileSync(file, "utf8")) : [];

describe.skipIf(!file)("live connectors", () => {
  for (const c of connections.filter((x) => !only || only.includes(x.connector))) {
    it(`${c.connector}: ${c.system}`, { timeout: 300_000 }, async () => {
      const def = BUILTIN_DEFINITIONS.find((d) => d.key === c.connector);
      expect(def, `no built-in connector ${c.connector}`).toBeDefined();
      // Through the production gateway (policies and guard); this run is not recorded: it has no organization.
      const connector = createDefinitionConnector(openGateway({ tenantId: "live-test", integrationId: null, status: "connected" }));
      await connector.authenticate({ definition: { key: def!.key, version: def!.version, origin: "builtin" }, manifest: def, settings: c.settings }, JSON.stringify(c.secret));
      expect(await connector.testConnection()).toEqual({ ok: true });
      const summary: Record<string, number> = {};
      for (const kind of RESOURCE_KINDS) {
        if (!def!.resources[kind]) continue;
        const records = await connector.importKind(kind);
        summary[kind] = records.length;
        expect(records.length, `${kind} returned nothing`).toBeGreaterThan(0);
      }
      const issues = connector.drainIssues();
      await connector.close();
      process.stdout.write(`${c.connector}: ${JSON.stringify(summary)}${issues.length ? ` issues: ${JSON.stringify(issues.slice(0, 5))}` : ""}\n`);
      expect(issues).toEqual([]);
    });
  }
});
