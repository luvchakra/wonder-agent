import { ApiError } from "@/lib/shared/types/foundation";
import { safeErrorMessage } from "@/lib/security/redact";

/**
 * Shared outbound request helper for the two payment providers. Fixed,
 * hard-coded provider hosts only (no customer-supplied URLs, so the
 * connector SSRF guard is not involved), a timeout, one retry on network
 * failure or 5xx/429 for idempotent requests, and errors that never carry
 * the key or the provider's raw body into logs (§17.7).
 */

export type ProviderRequest = {
  url: string;
  method: "GET" | "POST" | "DELETE" | "PATCH";
  headers: Record<string, string>;
  body?: string;
  /** Safe to retry: GETs, and POSTs carrying an idempotency key. */
  retryable: boolean;
  provider: "stripe" | "razorpay";
};

const TIMEOUT_MS = 15_000;

export async function providerFetch<T>(req: ProviderRequest, fetchImpl: typeof fetch = fetch): Promise<T> {
  const attempts = req.retryable ? 2 : 1;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal, cache: "no-store" });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok) return json as T;
      const message = providerErrorMessage(req.provider, json) ?? `HTTP ${res.status}`;
      if ((res.status >= 500 || res.status === 429) && i + 1 < attempts) {
        lastError = new Error(message);
        continue;
      }
      throw new ApiError(res.status >= 500 ? 502 : 400, "PAYMENT_PROVIDER_ERROR", `${req.provider === "stripe" ? "Stripe" : "Razorpay"}: ${safeErrorMessage(message)}`);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastError = err;
      if (i + 1 >= attempts) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ApiError(502, "PAYMENT_PROVIDER_UNAVAILABLE", `${req.provider === "stripe" ? "Stripe" : "Razorpay"} could not be reached: ${safeErrorMessage(lastError)}`);
}

function providerErrorMessage(provider: "stripe" | "razorpay", json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as { error?: { message?: unknown; description?: unknown } }).error;
  if (!err) return null;
  const m = provider === "stripe" ? err.message : (err.description ?? err.message);
  return typeof m === "string" ? m : null;
}
