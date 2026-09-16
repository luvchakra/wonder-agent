// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AnnouncementsBanner } from "./AnnouncementsBanner";
import type { PlatformAnnouncement } from "@/modules/platform-admin/service";

function makeAnnouncement(overrides: Partial<PlatformAnnouncement> = {}): PlatformAnnouncement {
  return {
    id: "a1",
    scope: "global",
    tenantId: null,
    type: "notice",
    title: "Heads up",
    body: "Something you should know.",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: null,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("AnnouncementsBanner — PLATFORM-P0-05.4", () => {
  it("renders nothing when there are no active announcements", () => {
    const { container } = render(<AnnouncementsBanner announcements={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a notice announcement's title and body", () => {
    render(<AnnouncementsBanner announcements={[makeAnnouncement()]} />);
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Something you should know.")).toBeInTheDocument();
  });

  it("renders every active announcement when there are several", () => {
    render(
      <AnnouncementsBanner
        announcements={[makeAnnouncement({ id: "a1", title: "First" }), makeAnnouncement({ id: "a2", title: "Second", type: "maintenance" })]}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });
});
