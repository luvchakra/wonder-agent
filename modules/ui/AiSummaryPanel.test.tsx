// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AiSummaryPanel } from "./AiSummaryPanel";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("AiSummaryPanel — EXPERIENCE-P0-14", () => {
  it("shows a Summarize button initially, never fetching until clicked", () => {
    global.fetch = vi.fn();
    render(<AiSummaryPanel kind="finding" data={{ id: "f1" }} />);
    expect(screen.getByRole("button", { name: /summarize with ai/i })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders a clearly-labeled advisory summary on success, distinct from the underlying data", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { kind: "finding", summary: "This finding indicates excessive access.", provider: "anthropic", generatedAt: "2026-09-16T00:00:00Z" } }),
    });
    render(<AiSummaryPanel kind="finding" data={{ id: "f1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /summarize with ai/i }));

    await waitFor(() => expect(screen.getByText("This finding indicates excessive access.")).toBeInTheDocument());
    expect(screen.getByText(/advisory only, not a decision/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/ai/summarize",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "finding", data: { id: "f1" } }) }),
    );
  });

  it("shows a plain not-configured notice on a 501, never a crash or a fake summary", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 501, json: async () => ({ ok: false, error: { code: "AI_NOT_CONFIGURED" } }) });
    render(<AiSummaryPanel kind="finding" data={{ id: "f1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /summarize with ai/i }));

    await waitFor(() => expect(screen.getByText(/aren.t configured for this workspace yet/i)).toBeInTheDocument());
  });

  it("shows a retryable error state when the request fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    render(<AiSummaryPanel kind="finding" data={{ id: "f1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /summarize with ai/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
