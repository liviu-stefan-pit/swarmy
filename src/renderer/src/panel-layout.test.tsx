import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { App } from "./App";
import { defaultPanelLayout, reloadPanelLayout, usePanelLayoutStore } from "./panel-layout-store";
import { useWorkflowStore } from "./workflow-store";

beforeEach(() => {
  localStorage.clear();
  usePanelLayoutStore.setState({ ...defaultPanelLayout });
  useWorkflowStore.setState(useWorkflowStore.getInitialState(), true);
  window.swarmy.engine.onStatus = (listener) => {
    listener("connected");
    return () => undefined;
  };
});

afterEach(() => {
  cleanup();
});

function inspectorWidth(): number {
  const width = Number.parseInt(screen.getByTestId("node-inspector").style.width, 10);
  expect(Number.isFinite(width)).toBe(true);
  return width;
}

it("Collapsing Nodes hides the palette buttons, and the same control shows them again", async () => {
  render(<App />);

  expect(await screen.findByTestId("palette-agent")).toBeInTheDocument();
  expect(screen.getByTestId("palette-textInput")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("collapse-palette"));

  const palette = screen.getByTestId("node-palette");
  expect(screen.queryByTestId("palette-agent")).not.toBeInTheDocument();
  expect(screen.queryByTestId("palette-textInput")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Nodes" })).not.toBeInTheDocument();
  expect(palette.style.width).toBe("40px");
  expect(palette.querySelector("svg")).toBeTruthy();

  fireEvent.click(screen.getByTestId("collapse-palette"));

  expect(screen.getByTestId("palette-agent")).toBeInTheDocument();
  expect(screen.getByTestId("palette-textInput")).toBeInTheDocument();
});

it("Dragging the inspector handle stores a new width, and that width is still there after the layout state is reloaded", async () => {
  const saved: unknown[] = [];
  window.swarmy.workflows.save = (workflow) => {
    saved.push(structuredClone(workflow));
    return Promise.resolve({
      id: workflow.id,
      name: workflow.name,
      createdAt: 0,
      updatedAt: 0,
    });
  };

  render(<App />);
  const handle = await screen.findByTestId("resize-inspector");
  const before = inspectorWidth();

  fireEvent.pointerDown(handle, { clientX: 400, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });

  const dragged = inspectorWidth();
  expect(dragged).toBeGreaterThan(before);
  expect(JSON.stringify(useWorkflowStore.getState().workflow)).not.toContain("inspectorWidth");
  expect(JSON.stringify(saved)).not.toContain("inspectorWidth");

  usePanelLayoutStore.setState({ inspectorWidth: defaultPanelLayout.inspectorWidth });
  expect(usePanelLayoutStore.getState().inspectorWidth).toBe(defaultPanelLayout.inspectorWidth);

  await act(async () => {
    reloadPanelLayout();
  });

  expect(inspectorWidth()).toBe(dragged);
  expect(usePanelLayoutStore.getState().inspectorWidth).toBe(dragged);
});

function bottomStackHeight(): number {
  const height = Number.parseInt(screen.getByTestId("bottom-stack").style.height, 10);
  expect(Number.isFinite(height)).toBe(true);
  return height;
}

function mockHeight(element: Element, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      width: 100,
      height,
      toJSON() {
        return {};
      },
    }) as DOMRect;
}

it("puts the Run history collapse control on the right of the row", () => {
  render(<App />);

  const button = screen.getByTestId("collapse-history");
  const select = screen.getByTestId("run-history-list");
  expect(button.parentElement?.className).toContain("justify-between");
  expect(button.parentElement?.lastElementChild).toBe(button);
  expect(select.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

it("Dragging the bottom handle down shortens the stack, and the stack stops before the header", async () => {
  render(<App />);
  await screen.findByTestId("node-palette");
  const handle = screen.getByTestId("resize-bottom");
  const before = bottomStackHeight();

  fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: 480, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientY: 480, pointerId: 1 });

  expect(bottomStackHeight()).toBeLessThan(before);

  const editor = screen.getByTestId("workflow-editor");
  const stack = screen.getByTestId("bottom-stack");
  mockHeight(editor, 200);
  mockHeight(stack, before);
  fireEvent.pointerDown(handle, { clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientY: 0, pointerId: 1 });

  expect(bottomStackHeight()).toBeLessThanOrEqual(before + 200 - 160);
});

it("Collapsing Run log hides the log text and leaves the Run log heading", async () => {
  render(<App />);

  expect(await screen.findByTestId("run-log")).toHaveTextContent("No run yet.");
  const before = bottomStackHeight();

  fireEvent.click(screen.getByTestId("collapse-run-log"));

  expect(screen.queryByTestId("run-log")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Run log" })).toBeInTheDocument();
  expect(bottomStackHeight()).toBeLessThan(before);
});
