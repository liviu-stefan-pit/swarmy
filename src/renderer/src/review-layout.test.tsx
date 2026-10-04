import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { defaultPanelLayout, usePanelLayoutStore } from "./panel-layout-store";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

vi.mock("./DiffReview", () => ({
  DiffReview({
    height,
    modified,
    onChange,
  }: {
    height?: number;
    modified: string;
    onChange: (text: string) => void;
  }) {
    return (
      <textarea
        data-testid="diff-modified"
        data-height={String(height ?? 240)}
        defaultValue={modified}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  },
}));

const pending = {
  nodeId: "review",
  summary: "wrote the change",
  workspacePath: "C:\\wt\\writer",
  files: [{ path: "README.md", original: "hello\n", modified: "hello world\n" }],
};

function diffHeight(): number {
  const height = Number(screen.getByTestId("diff-modified").getAttribute("data-height"));
  expect(Number.isFinite(height)).toBe(true);
  return height;
}

function stackHeight(): number {
  const height = Number.parseInt(screen.getByTestId("bottom-stack").style.height, 10);
  expect(Number.isFinite(height)).toBe(true);
  return height;
}

function halfTheSpace(): number {
  const header = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
  const footer = document.querySelector("[data-testid='engine-status']")?.getBoundingClientRect().height ?? 0;
  const connection = document.querySelector("details")?.getBoundingClientRect().height ?? 0;
  return Math.round((window.innerHeight - header - footer - connection) / 2);
}

beforeEach(() => {
  localStorage.clear();
  usePanelLayoutStore.setState({ ...defaultPanelLayout, bottomHeight: 640 });
  useWorkflowStore.setState({
    workflow: {
      id: "diff-review",
      name: "Diff review",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "review",
          type: "approval",
          position: { x: 0, y: 0 },
          data: { label: "Review" },
        },
      ],
      edges: [],
    },
  });
  useRunStore.setState({
    ...useRunStore.getInitialState(),
    workflowRunning: true,
    approvals: [pending],
  });
  window.swarmy.engine.onStatus = (listener) => {
    listener("reconnecting");
    return () => undefined;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("gives a tall inbox a diff taller than 240px, and the diff shrinks when the area does", async () => {
  render(<App />);

  expect(await screen.findByTestId("bottom-tab-inbox")).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByTestId("diff-modified")).toBeInTheDocument();
  const tall = diffHeight();
  expect(tall).toBeGreaterThan(240);

  await act(async () => {
    usePanelLayoutStore.getState().setBottomHeight(360);
  });

  expect(diffHeight()).toBeLessThan(tall);
});

it("hides the diff on the board and shows it again from the inbox", async () => {
  render(<App />);

  expect(await screen.findByTestId("diff-editor")).toBeVisible();

  fireEvent.click(screen.getByTestId("bottom-tab-board"));

  expect(screen.getByTestId("diff-editor")).not.toBeVisible();
  expect(screen.getByTestId("task-board")).toBeVisible();

  fireEvent.click(screen.getByTestId("bottom-tab-inbox"));

  expect(screen.getByTestId("diff-editor")).toBeVisible();
});

it("sends the edited text when you approve from the inbox", async () => {
  const decide = vi.spyOn(window.swarmy.runs, "decide").mockResolvedValue(undefined);
  render(<App />);

  fireEvent.click(await screen.findByTestId("bottom-tab-board"));
  fireEvent.click(screen.getByTestId("bottom-tab-inbox"));
  fireEvent.change(await screen.findByTestId("diff-modified"), { target: { value: "approved word\n" } });
  fireEvent.click(screen.getByTestId("approval-approve"));

  expect(decide).toHaveBeenCalledWith({
    nodeId: "review",
    action: "approve",
    files: [{ path: "README.md", text: "approved word\n" }],
  });
});

it("opens the inbox and grows a short area when an approval arrives", async () => {
  usePanelLayoutStore.setState({ ...defaultPanelLayout, bottomHeight: 140 });
  useRunStore.setState({ approvals: [], workflowRunning: false });
  render(<App />);

  const before = stackHeight();
  expect(before).toBeLessThan(halfTheSpace());

  await act(async () => {
    useRunStore.setState({ workflowRunning: true, approvals: [pending] });
  });

  expect(screen.getByTestId("bottom-tab-inbox")).toHaveAttribute("aria-selected", "true");
  expect(stackHeight()).toBeGreaterThanOrEqual(halfTheSpace());
});
