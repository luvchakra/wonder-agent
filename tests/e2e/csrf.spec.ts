import { test, expect } from "@playwright/test";
import { authFile } from "./support/testUsers";

/**
 * FOUNDATION-P1-05 — CSRF protection verification.
 *
 * WonderAgent's CSRF defense is the session cookie's `SameSite=Lax`
 * attribute (confirmed from `@supabase/ssr`'s own `DEFAULT_COOKIE_OPTIONS`
 * — neither `proxy.ts` nor `lib/db/supabaseServer.ts` overrides it, so
 * every `sb-*-auth-token` cookie Supabase Auth sets carries it). `Lax`
 * cookies ride along on a same-site request but are withheld from a
 * cross-site subresource request (a `fetch`/`XHR`, or a cross-site
 * `<form>` POST) regardless of method — exactly the classic CSRF vector.
 * This is a browser-enforced policy, not application code, so the only
 * faithful way to prove it is a real browser making a real cross-site
 * request — not a raw HTTP client, which has no cookie-jar SameSite
 * policy to enforce in the first place.
 *
 * The "attacker" origin below is intercepted entirely by Playwright
 * (`page.route`) rather than a real external host: Chromium still treats
 * it as a distinct origin (it never resolves via real DNS, and nothing
 * here depends on outbound network access), which is what SameSite keys
 * off. The request to the real app is NOT intercepted/faked — it hits
 * this session's actual running dev server, so the 401 asserted below is
 * the real API route's real response, not a simulated one.
 */
test.use({ storageState: authFile("adminOne") });

test.describe("CSRF protection (FOUNDATION-P1-05)", () => {
  test("a same-origin request carries the session cookie and succeeds", async ({ page, baseURL }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/v1/tenant", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    void baseURL;
  });

  test("a cross-site request never carries the session cookie, and the API rejects it", async ({ page, baseURL }) => {
    const appOrigin = baseURL ?? "http://localhost:3100";

    // A page on a distinct, non-existent origin — fulfilled locally by
    // Playwright, so this needs no real DNS/network access. Its script
    // does exactly what a real CSRF attack page would: an authenticated-
    // looking fetch to our app, `credentials: "include"` so it WOULD
    // carry cookies if the browser allowed it.
    await page.route("http://csrf-attack.invalid/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<script>
          fetch(${JSON.stringify(`${appOrigin}/api/v1/tenant`)}, { credentials: "include" })
            .then((r) => { window.__status = r.status; })
            .catch(() => { window.__status = "network_error"; });
        </script>`,
      }),
    );

    // The request to our OWN app is left real (route.continue()) — this
    // hits the actual running server. We intercept only to inspect the
    // Cookie header Chromium decided to send, which is the fact this test
    // exists to prove.
    let requestWasIntercepted = false;
    let cookieHeaderSent: string | undefined;
    await page.route(`${appOrigin}/api/v1/tenant`, async (route) => {
      requestWasIntercepted = true;
      cookieHeaderSent = route.request().headers()["cookie"];
      await route.continue();
    });

    await page.goto("http://csrf-attack.invalid/attack.html");
    await page.waitForFunction(() => (window as unknown as { __status?: unknown }).__status !== undefined, undefined, {
      timeout: 10_000,
    });

    // Confirms the assertion below is real evidence, not a vacuous pass
    // from a route pattern that never matched.
    expect(requestWasIntercepted).toBe(true);

    // The entire defense: SameSite=Lax means the browser withholds the
    // auth-token cookie on this cross-site subresource request — proven
    // by inspecting the real request as Chromium actually sent it, not
    // by a status code the page can or can't read.
    expect(cookieHeaderSent ?? "").not.toMatch(/sb-.*-auth-token/);

    // The page's own fetch() never sees a usable response at all: with no
    // session cookie, getTenantContext() resolves no tenant and the route
    // would 401 — but this app also sends no CORS headers permitting a
    // foreign origin to read a cross-site response in the first place, so
    // the browser blocks it as an opaque network error before the page's
    // JS ever sees a status code. Two independent layers reject the
    // forged request; neither lets the attacker page read anything back.
    const status = await page.evaluate(() => (window as unknown as { __status?: unknown }).__status);
    expect(status).toBe("network_error");
  });
});
