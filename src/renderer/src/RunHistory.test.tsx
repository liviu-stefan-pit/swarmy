import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultPanelLayout, usePanelLayoutStore } from "./panel-layout-store";
import { RunHistory } from "./RunHistory";
import { useRunStore } from "./run-store";
import { useWorkflowStore } from "./workflow-store";

const workflow = {
  id: "line",
  name: "Line",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
};

const checkpoints = [
  { checkpointId: "cp-1", nodeId: "first", label: "First", time: "2026-10-04T12:00:00.000Z" },
  { checkpointId: "cp-2", nodeId: "second", label: "Second", time: "2026-10-04T12:01:00.000Z" },
  { checkpointId: "cp-3", nodeId: "third", label: "Third", time: "2026-10-04T12:02:00.000Z" },
];

beforeEach(() => {
  localStorage.clear();
  usePanelLayoutStore.setState({ ...defaultPanelLayout });
  useWorkflowStore.setState({ workflow });
  useRunStore.setState({
    statusByNode: {},
    unfinishedThreadId: null,
    historyRevision: 0,
    workflowRunning: false,
    activeNodeId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows checkpoints in order and forks the selected one", async () => {
  vi.spyOn(window.swarmy.runs, "history").mockResolvedValue([
    { threadId: "thread-1", status: "completed", startedAt: 1, endedAt: 2 },
  ]);
  vi.spyOn(window.swarmy.runs, "openHistory").mockResolvedValue({
    threadId: "thread-1",
    status: "completed",
    startedAt: 1,
    endedAt: 2,
    nodes: [],
  });
  vi.spyOn(window.swarmy.runs, "checkpoints").mockResolvedValue(checkpoints);
  const fork = vi.spyOn(window.swarmy.runs, "fork").mockResolvedValue({
    threadId: "thread-2",
    nextNodeId: "third",
    statuses: { first: "completed", second: "completed", third: "idle" },
  });

  render(<RunHistory />);
  fireEvent.change(await screen.findByTestId("run-history-list"), { target: { value: "thread-1" } });

  const rows = await screen.findAllByTestId("checkpoint");
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("First"),
    expect.stringContaining("Second"),
    expect.stringContaining("Third"),
  ]);

  fireEvent.click(rows[1] ?? rows[0]);
  fireEvent.click(screen.getByTestId("fork-checkpoint"));

  await waitFor(() => {
    expect(fork).toHaveBeenCalledWith(workflow, "thread-1", "cp-2");
  });
  expect(useRunStore.getState().statusByNode).toMatchObject({
    first: "completed",
    second: "completed",
    third: "idle",
  });
  expect(useRunStore.getState().unfinishedThreadId).toBe("thread-2");
});

it("shows the summed token total and the cache-read split", async () => {
  vi.spyOn(window.swarmy.runs, "history").mockResolvedValue([
    { threadId: "thread-1", status: "completed", startedAt: 1, endedAt: 2 },
  ]);
  vi.spyOn(window.swarmy.runs, "openHistory").mockResolvedValue({
    threadId: "thread-1",
    status: "completed",
    startedAt: 1,
    endedAt: 2,
    nodes: [
      tokenNode("first", 7, { inputTokens: 2, outputTokens: 1, cacheReadTokens: 4, cacheWriteTokens: 0 }),
      tokenNode("second", 9, { inputTokens: 3, outputTokens: 1, cacheReadTokens: 5, cacheWriteTokens: 0 }),
      tokenNode("third", 12, { inputTokens: 4, outputTokens: 1, cacheReadTokens: 6, cacheWriteTokens: 1 }),
    ],
  });
  vi.spyOn(window.swarmy.runs, "checkpoints").mockResolvedValue([]);

  render(<RunHistory />);
  fireEvent.change(await screen.findByTestId("run-history-list"), { target: { value: "thread-1" } });

  expect(await screen.findByTestId("run-history-tokens")).toHaveTextContent(
    "28 tokens (input 9, output 3, cache read 15, cache write 1)",
  );
});

it("shows only the token total when the parts were not stored", async () => {
  vi.spyOn(window.swarmy.runs, "history").mockResolvedValue([
    { threadId: "thread-1", status: "completed", startedAt: 1, endedAt: 2 },
  ]);
  vi.spyOn(window.swarmy.runs, "openHistory").mockResolvedValue({
    threadId: "thread-1",
    status: "completed",
    startedAt: 1,
    endedAt: 2,
    nodes: [
      tokenNode("first", 7, null),
      tokenNode("second", 9, null),
      tokenNode("third", 12, null),
    ],
  });
  vi.spyOn(window.swarmy.runs, "checkpoints").mockResolvedValue([]);

  render(<RunHistory />);
  fireEvent.change(await screen.findByTestId("run-history-list"), { target: { value: "thread-1" } });

  const line = await screen.findByTestId("run-history-tokens");
  expect(line).toHaveTextContent("28 tokens");
  expect(line).not.toHaveTextContent("cache read");
});

function tokenNode(
  nodeId: string,
  totalTokens: number,
  parts: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  } | null,
) {
  return {
    nodeId,
    transcript: "",
    totalTokens,
    costState: "known" as const,
    chargedCents: null,
    inputTokens: parts?.inputTokens ?? null,
    outputTokens: parts?.outputTokens ?? null,
    cacheReadTokens: parts?.cacheReadTokens ?? null,
    cacheWriteTokens: parts?.cacheWriteTokens ?? null,
  };
}
