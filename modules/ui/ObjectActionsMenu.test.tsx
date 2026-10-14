// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CreateDialogForm, ObjectActionsMenu, useCloseCreateDialog } from "./ObjectActionsMenu";

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Actions/ }), { key: "Enter" });
}

function CloseAfterCreate() {
  const close = useCloseCreateDialog();
  return (
    <button type="button" onClick={close}>
      Save
    </button>
  );
}

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

  it("renders the menu when only a create item is given", () => {
    render(<ObjectActionsMenu create={{ label: "Create policy…", title: "Create a policy", content: <p>form</p> }} />);
    expect(screen.getByRole("button", { name: /Actions/ })).toBeInTheDocument();
  });

  it("lists the create item first, separated from export", () => {
    render(
      <ObjectActionsMenu
        exports={[{ label: "Export CSV", href: "/api/v1/exports/policies" }]}
        create={{ label: "Create policy…", title: "Create a policy", content: <p>form</p> }}
      />,
    );
    openMenu();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Create policy…", "Export CSV"]);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("opens the create form in a dialog titled by the item", () => {
    render(<ObjectActionsMenu create={{ label: "Create policy…", title: "Create a policy", content: <label>Policy name<input /></label> }} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Create policy…" }));
    const dialog = screen.getByRole("dialog", { name: "Create a policy" });
    expect(dialog).toContainElement(screen.getByLabelText("Policy name"));
  });

  it("starts in the form's first field", async () => {
    render(<ObjectActionsMenu create={{ label: "Create policy…", title: "Create a policy", content: <label>Policy name<input /></label> }} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Create policy…" }));
    await waitFor(() => expect(screen.getByLabelText("Policy name")).toHaveFocus());
  });

  it("closes when the form calls useCloseCreateDialog", () => {
    render(<ObjectActionsMenu create={{ label: "New group…", title: "New group", content: <CloseAfterCreate /> }} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "New group…" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("CreateDialogForm runs the action and then closes the dialog", async () => {
    const action = vi.fn(async () => {});
    render(
      <ObjectActionsMenu
        create={{
          label: "Add attribute…",
          title: "Add an attribute",
          content: (
            <CreateDialogForm action={action}>
              <input name="key" defaultValue="cost_centre" aria-label="Key" />
              <button type="submit">Add</button>
            </CreateDialogForm>
          ),
        }}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add attribute…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(action).toHaveBeenCalledTimes(1);
    expect((action.mock.calls[0] as unknown as [FormData])[0].get("key")).toBe("cost_centre");
  });

  it("useCloseCreateDialog does nothing outside the dialog", () => {
    render(<CloseAfterCreate />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Save" }))).not.toThrow();
  });
});
