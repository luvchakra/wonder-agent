// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestHttpClient } from "./restHttpClient";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("RestHttpClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the configured auth header for api_key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new RestHttpClient("https://api.example.test", "api_key", "secret-123", {}, "x-api-key", 1000);
    await client.get("/ping");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("secret-123");
  });

  it("sends a Bearer Authorization header for bearer/oauth2", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new RestHttpClient("https://api.example.test", "bearer", "tok-abc", {}, "x-api-key", 1000);
    await client.get("/ping");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok-abc");
  });

  it("paginates offset-style until a short page is returned", async () => {
    const pages = [
      Array.from({ length: 2 }, (_, i) => ({ id: `a${i}` })),
      Array.from({ length: 2 }, (_, i) => ({ id: `b${i}` })),
      [{ id: "c0" }], // short page — stop here
    ];
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      const page = pages[call];
      call += 1;
      return Promise.resolve(jsonResponse(page));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RestHttpClient("https://api.example.test", "bearer", "t", {}, "x-api-key", 1000);
    const records = await client.fetchAllPages("/things", { style: "offset", pageSize: 2 });

    expect(records).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("paginates cursor-style following a nested cursor field until absent", async () => {
    const responses = [
      { results: [{ id: "a" }], nextCursor: "page2" },
      { results: [{ id: "b" }], nextCursor: "page3" },
      { results: [{ id: "c" }] }, // no nextCursor — stop
    ];
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      const body = responses[call];
      call += 1;
      return Promise.resolve(jsonResponse(body));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RestHttpClient("https://api.example.test", "bearer", "t", {}, "x-api-key", 1000);
    const records = await client.fetchAllPages("/things", {
      style: "cursor",
      dataPath: "results",
      cursorPath: "nextCursor",
    });

    expect(records.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("extracts records from a nested dataPath for non-paginated responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { items: [{ id: "x" }] } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new RestHttpClient("https://api.example.test", "bearer", "t", {}, "x-api-key", 1000);
    const records = await client.fetchAllPages("/things", { style: "none", dataPath: "data.items" });

    expect(records).toEqual([{ id: "x" }]);
  });

  it("throws when a page request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false));
    vi.stubGlobal("fetch", fetchMock);

    const client = new RestHttpClient("https://api.example.test", "bearer", "t", {}, "x-api-key", 1000);
    await expect(client.fetchAllPages("/things")).rejects.toThrow("HTTP 500");
  });
});
