import "server-only";

import { guardedFetch } from "../outboundFetch";

/**
 * Shared HTTP/pagination/throttling helper used by both the Generic REST and
 * Saviynt connectors (both are, mechanically, paginated REST APIs behind
 * different auth/endpoint conventions) — kept here once rather than
 * duplicated across connector files.
 */
export type PaginationConfig = {
  style?: "offset" | "cursor" | "none";
  pageParam?: string;
  sizeParam?: string;
  pageSize?: number;
  dataPath?: string;
  cursorPath?: string;
  cursorParam?: string;
};

export type AuthType = "oauth2" | "api_key" | "basic" | "bearer" | "mtls";

export class RestHttpClient {
  private lastRequestAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly authType: AuthType | undefined,
    private readonly secret: string | null,
    private readonly extraHeaders: Record<string, string> = {},
    private readonly apiKeyHeader: string = "x-api-key",
    private readonly rateLimitPerSecond: number = 5,
  ) {}

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.extraHeaders };
    if (!this.secret) return headers;
    switch (this.authType) {
      case "api_key":
        headers[this.apiKeyHeader] = this.secret;
        return headers;
      case "bearer":
      case "oauth2":
        headers.Authorization = `Bearer ${this.secret}`;
        return headers;
      case "basic":
        headers.Authorization = `Basic ${Buffer.from(this.secret, "utf8").toString("base64")}`;
        return headers;
      default:
        return headers;
    }
  }

  private async throttle(): Promise<void> {
    const minIntervalMs = 1000 / this.rateLimitPerSecond;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, minIntervalMs - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  async get(path: string): Promise<Response> {
    await this.throttle();
    const url = new URL(path, this.baseUrl);
    // INTEGRATION-P0-11: customer-supplied base URLs go through the SSRF guard.
    return guardedFetch(url, { headers: this.authHeaders() });
  }

  async post(path: string, body: Record<string, unknown>): Promise<Response> {
    await this.throttle();
    const url = new URL(path, this.baseUrl);
    return guardedFetch(url, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private extractPath(body: unknown, dotPath?: string): unknown {
    if (!dotPath) return body;
    return dotPath.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, body);
  }

  async fetchAllPages(
    endpointPath: string,
    pagination: PaginationConfig = { style: "none" },
  ): Promise<Record<string, unknown>[]> {
    const style = pagination.style ?? "none";
    const dataPath = pagination.dataPath;
    const results: Record<string, unknown>[] = [];

    if (style === "none") {
      const res = await this.get(endpointPath);
      if (!res.ok) throw new Error(`GET ${endpointPath} failed: HTTP ${res.status}`);
      const data = this.extractPath(await res.json(), dataPath);
      if (Array.isArray(data)) results.push(...(data as Record<string, unknown>[]));
      return results;
    }

    if (style === "offset") {
      const pageParam = pagination.pageParam ?? "page";
      const sizeParam = pagination.sizeParam ?? "pageSize";
      const pageSize = pagination.pageSize ?? 100;
      let page = 1;
      for (;;) {
        const sep = endpointPath.includes("?") ? "&" : "?";
        const res = await this.get(`${endpointPath}${sep}${pageParam}=${page}&${sizeParam}=${pageSize}`);
        if (!res.ok) throw new Error(`GET ${endpointPath} failed: HTTP ${res.status}`);
        const data = this.extractPath(await res.json(), dataPath);
        const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
        results.push(...items);
        if (items.length < pageSize) break;
        page += 1;
      }
      return results;
    }

    const cursorPath = pagination.cursorPath;
    const cursorParam = pagination.cursorParam ?? "cursor";
    let cursor: string | undefined;
    for (;;) {
      const sep = endpointPath.includes("?") ? "&" : "?";
      const path = cursor ? `${endpointPath}${sep}${cursorParam}=${cursor}` : endpointPath;
      const res = await this.get(path);
      if (!res.ok) throw new Error(`GET ${endpointPath} failed: HTTP ${res.status}`);
      const body = await res.json();
      const data = this.extractPath(body, dataPath);
      if (Array.isArray(data)) results.push(...(data as Record<string, unknown>[]));
      const next = cursorPath ? this.extractPath(body, cursorPath) : undefined;
      if (!next || typeof next !== "string") break;
      cursor = next;
    }
    return results;
  }

  /**
   * Saviynt's Enterprise Identity Cloud list APIs (getUser, getAccounts,
   * getEntitlements, getEndpoints, getSecuritySystems, getEntDetailsforUsers
   * — verified against Saviynt Enterprise Identity Cloud API Reference
   * v24.2) are POST endpoints that take their filter/pagination parameters
   * (`max`/`offset`) in a JSON request body, not GET with query-string
   * pagination — a materially different mechanism than the offset/cursor
   * GET pagination above, which Generic REST connectors use. This method is
   * additive; it does not change `get()`/`fetchAllPages()`'s existing
   * GET-based contract that Generic REST still relies on.
   */
  async postAllPages(
    endpointPath: string,
    baseBody: Record<string, unknown>,
    options: { pageParam?: string; sizeParam?: string; pageSize?: number; dataPath?: string } = {},
  ): Promise<Record<string, unknown>[]> {
    const pageParam = options.pageParam ?? "offset";
    const sizeParam = options.sizeParam ?? "max";
    const pageSize = options.pageSize ?? 100;
    const dataPath = options.dataPath;
    const results: Record<string, unknown>[] = [];

    let offset = 0;
    for (;;) {
      const res = await this.post(endpointPath, { ...baseBody, [pageParam]: offset, [sizeParam]: pageSize });
      if (!res.ok) throw new Error(`POST ${endpointPath} failed: HTTP ${res.status}`);
      const data = this.extractPath(await res.json(), dataPath);
      const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      results.push(...items);
      if (items.length < pageSize) break;
      offset += pageSize;
    }
    return results;
  }
}
