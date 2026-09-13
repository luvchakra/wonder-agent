import { vi } from "vitest";

// The `server-only` package throws unconditionally unless a bundler resolves
// it to its `react-server` export condition (Next.js does this at build
// time). Vitest has no such resolution, so treat it as a no-op here —
// production behavior is unaffected; this only unblocks unit-testing pure
// logic in modules that import "server-only" as a defense-in-depth marker.
vi.mock("server-only", () => ({}));
