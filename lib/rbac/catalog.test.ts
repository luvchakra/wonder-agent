// @vitest-environment node
import { describe, expect, it } from "vitest";
import { filterCatalog, type CatalogPermission } from "./catalog";

const p = (key: string, module: CatalogPermission["module"], sensitivity: CatalogPermission["sensitivity"], label = key): CatalogPermission => ({
  key,
  label,
  description: `${label} description`,
  resource: key.split(".")[0]!,
  action: key.split(".")[1]!,
  module,
  sensitivity,
  roles: [],
});
const items = [p("agent.read", "DISCOVER", "standard", "View AI agents"), p("runtime.emergency", "PROTECT", "privileged", "Use emergency controls"), p("users.view", "ADMINISTRATION", "standard", "View users")];

describe("filterCatalog", () => {
  it("filters by module, sensitivity and free text over key, label, resource and description", () => {
    expect(filterCatalog(items, {}).length).toBe(3);
    expect(filterCatalog(items, { module: "PROTECT" }).map((x) => x.key)).toEqual(["runtime.emergency"]);
    expect(filterCatalog(items, { sensitivity: "standard" }).length).toBe(2);
    expect(filterCatalog(items, { q: "EMERGENCY" }).map((x) => x.key)).toEqual(["runtime.emergency"]);
    expect(filterCatalog(items, { q: "users" }).map((x) => x.key)).toEqual(["users.view"]);
    expect(filterCatalog(items, { q: "view", module: "DISCOVER" }).map((x) => x.key)).toEqual(["agent.read"]);
  });
});
