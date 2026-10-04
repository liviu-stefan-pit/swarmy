import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime } from "./fake-runtime";
import { runWorkflow } from "./orchestrator";
import { openTaskBoard } from "./task-board";
import { createWorkspaceManager } from "./workspace-manager";

const scripted = {
  id: "task-1",
  owner: "alpha",
  status: "open",
  summary: "write the file",
};

it("update_task then inspect_board returns the row, and another run does not see it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "swarmy-board-"));
  const board = openTaskBoard(join(dir, "swarmy.db"));
  try {
    const runA = board.tools("run-a");
    const runB = board.tools("run-b");
    await runA.update_task.execute(toolArgs(scripted));
    const seen = JSON.parse(String(await runA.inspect_board.execute({}))) as unknown;
    expect(seen).toEqual([scripted]);
    const other = JSON.parse(String(await runB.inspect_board.execute({}))) as unknown;
    expect(other).toEqual([]);
  } finally {
    board.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps both rows when two parallel agents write the board", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("FakeRuntime must not call the network");
  });
  const dir = await mkdtemp(join(tmpdir(), "swarmy-board-"));
  const workRoot = await mkdtemp(join(tmpdir(), "swarmy-board-ws-"));
  const board = openTaskBoard(join(dir, "swarmy.db"));
  const workspaces = createWorkspaceManager({ rootDir: workRoot });
  const alpha = { id: "alpha-task", owner: "alpha", status: "open", summary: "alpha work" };
  const beta = { id: "beta-task", owner: "beta", status: "doing", summary: "beta work" };
  const runtime = new FakeRuntime({
    accountLabel: "fake@swarmy.local",
    models: [{ id: "fake-model" }],
    helloText: "Hello from the fake runtime.",
    prompts: {
      "alpha-task": { chunks: ["alpha"], hold: true, result: "alpha done", task: alpha },
      "beta-task": { chunks: ["beta"], hold: true, result: "beta done", task: beta },
    },
  });

  try {
    const pending = runWorkflow({
      workflow: parallelWorkflow(),
      runtime,
      apiKey: "fake-key",
      workspaces,
      threadId: "run-parallel",
      taskBoard: board,
    });

    await vi.waitFor(() => {
      expect(board.list("run-parallel")).toEqual([alpha, beta]);
    });
    expect(runtime.finishedPrompts).toHaveLength(0);

    runtime.releaseHeld();
    const result = await pending;
    expect(result.statuses).toMatchObject({ alpha: "completed", beta: "completed" });
    expect(board.list("run-parallel")).toEqual([alpha, beta]);
    const other = JSON.parse(String(await board.tools("run-other").inspect_board.execute({}))) as unknown;
    expect(other).toEqual([]);
  } finally {
    fetchSpy.mockRestore();
    board.close();
    await rm(dir, { recursive: true, force: true });
    await rm(workRoot, { recursive: true, force: true });
  }
});

function toolArgs(fields: {
  id: string;
  owner: string;
  status: string;
  summary: string;
}): Record<string, unknown> {
  return {
    id: fields.id,
    owner: fields.owner,
    status: fields.status,
    summary: fields.summary,
  };
}

function parallelWorkflow(): Workflow {
  return {
    id: "parallel",
    name: "Parallel",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "alpha",
        type: "agent",
        position: { x: 0, y: 0 },
        data: { label: "alpha", taskPrompt: "alpha-task" },
      },
      {
        id: "beta",
        type: "agent",
        position: { x: 240, y: 0 },
        data: { label: "beta", taskPrompt: "beta-task" },
      },
    ],
    edges: [],
  };
}
