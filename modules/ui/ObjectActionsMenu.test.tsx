// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ObjectActionsMenu } from "./ObjectActionsMenu";

describe("ObjectActionsMenu", () => {
  it("renders nothing when the viewer has no item", () => {
    const { container } = render(<ObjectActionsMenu exports={[]} imports={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one Actions button otherwise", () => {
    render(<ObjectActionsMenu exports={[{ label: "Export CSV", href: "/api/v1/exports/agents" }]} />);
    const button = screen.getByRole("button", { name: /Actions/ });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
