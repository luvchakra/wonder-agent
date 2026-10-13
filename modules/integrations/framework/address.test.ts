import { describe, expect, it } from "vitest";
import { addressKey, addressOf } from "./address";
import type { ConnectorDefinition } from "./types";

const def = (keys: [string, "url" | "text"][]) => ({ settings: keys.map(([key, type]) => ({ key, label: key, type })) }) as unknown as Pick<ConnectorDefinition, "settings">;

describe("WID-H05: a connection's address", () => {
  it("is its baseUrl url setting, else its first url setting", () => {
    expect(addressKey(def([["url", "url"], ["baseUrl", "url"]]))).toBe("baseUrl");
    expect(addressKey(def([["tenant", "text"], ["server", "url"], ["backup", "url"]]))).toBe("server");
    expect(addressKey(def([["tenant", "text"]]))).toBeUndefined();
  });
  it("is the same value the Gateway checks and the drivers connect to, whatever order the settings are in", () => {
    const d = def([["url", "url"], ["baseUrl", "url"]]);
    expect(addressOf(d, { url: "ldaps://unlisted.example.org", baseUrl: "ldaps://listed.example.com" })).toBe("ldaps://listed.example.com");
  });
  it("is null when missing or not text", () => {
    expect(addressOf(def([["baseUrl", "url"]]), {})).toBeNull();
    expect(addressOf(def([["baseUrl", "url"]]), { baseUrl: 42 })).toBeNull();
    expect(addressOf(def([["tenant", "text"]]), { tenant: "x" })).toBeNull();
  });
});
