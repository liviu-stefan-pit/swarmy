import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime } from "./fake-runtime";
import { runWorkflow, type WorkflowRunUpdate } from "./orchestrator";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
};

function plannerWorkflow(goal: string): Workflow {
  return {
    id: "planner-run",
    name: "Planner",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "planner",
        type: "planner",
        position: { x: 0, y: 0 },
        data: { label: "Planner", taskPrompt: goal },
      },
    ],
    edges: [],
  } as Workflow;
}

function nineTasks(): { tasks: { id: string; title: string; prompt: string }[] } {
  return {
    tasks: Array.from({ length: 9 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `Title ${index + 1}`,
      prompt: `worker-${index + 1}`,
    })),
  };
}

async function withWorkspaces(
  run: (workspaces: WorkspaceManager) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-planner-"));
  const workspaces = createWorkspaceManager({ rootDir: root });
  try {
    await run(workspaces);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function blockNetwork(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("FakeRuntime must not call the network");
  });
}

function workerPrompts(runtime: FakeRuntime): string[] {
  return runtime.sentPrompts.filter(
    (prompt) => prompt.includes("create-alpha") || prompt.includes("create-beta") || prompt.includes("create-gamma"),
  );
}

it("starts exactly two workers when submit_plan returns two tasks", async () => {
  const fetchSpy = blockNetwork();
  try {
    const runtime = new FakeRuntime({
      ...baseScript,
      prompts: {
        "split-goal": {
          chunks: ["planning"],
          result: "planned",
          plan: {
            tasks: [
              { id: "one", title: "First file", prompt: "create-alpha" },
              { id: "two", title: "Second file", prompt: "create-beta" },
            ],
          },
        },
      },
      defaultPrompt: {
        chunks: ["wrote"],
        result: "worker done",
        handoff: { summary: "wrote the file", files: ["note.txt"], blockers: [] },
      },
    });

    await withWorkspaces(async (workspaces) => {
      const result = await runWorkflow({
        workflow: plannerWorkflow("split-goal"),
        runtime,
        apiKey: "fake-key",
        workspaces,
      });

      const workers = workerPrompts(runtime);
      expect(workers).toHaveLength(2);
      expect(workers.filter((prompt) => prompt.includes("create-alpha"))).toHaveLength(1);
      expect(workers.filter((prompt) => prompt.includes("create-beta"))).toHaveLength(1);
      expect(runtime.sentPrompts.filter((prompt) => prompt.includes("create-gamma"))).toHaveLength(0);
      expect(workers.every((prompt) => prompt.includes("First file") && prompt.includes("Second file"))).toBe(true);
      expect(result.statuses.planner).toBe("completed");
      const plannerCreate = runtime.created.find((request) => request.customTools?.submit_plan);
      expect(plannerCreate?.tools).toEqual(["read", "grep", "glob", "ls", "mcp"]);
      expect(runtime.created.filter((request) => request.customTools?.submit_handoff)).toHaveLength(2);
      expect(runtime.created.every((request) => request.cwd.includes(`${sep}managed${sep}`))).toBe(true);
    });
  } finally {
    fetchSpy.mockRestore();
  }
});

it("rejects a plan with 9 tasks and does not start workers", async () => {
  const fetchSpy = blockNetwork();
  try {
    const tooMany = nineTasks();
    const runtime = new FakeRuntime({
      ...baseScript,
      prompts: {
        "split-goal": {
          chunks: ["planning"],
          result: "planned",
          plans: [tooMany, tooMany],
        },
      },
      defaultPrompt: { chunks: ["should not run"], result: "nope" },
    });
    const updates: WorkflowRunUpdate[] = [];

    await withWorkspaces(async (workspaces) => {
      const result = await runWorkflow({
        workflow: plannerWorkflow("split-goal"),
        runtime,
        apiKey: "fake-key",
        workspaces,
        onUpdate(update) {
          updates.push(update);
        },
      });

      expect(runtime.planReplies).toEqual([
        "A plan can have at most 8 tasks.",
        "The plan was already rejected.",
      ]);
      expect(runtime.sentPrompts.filter((prompt) => prompt.includes("worker-"))).toHaveLength(0);
      expect(result.statuses.planner).toBe("failed");
      const failed = updates.filter((update) => update.nodeId === "planner" && update.status === "failed");
      expect(failed.some((update) => update.log.includes("at most 8"))).toBe(true);
    });
  } finally {
    fetchSpy.mockRestore();
  }
});

it("fails the planner when submit_plan is never called", async () => {
  const fetchSpy = blockNetwork();
  try {
    const runtime = new FakeRuntime({
      ...baseScript,
      prompts: {
        "split-goal": { chunks: ["I will just describe the work"], result: "no tool call" },
      },
      defaultPrompt: { chunks: ["should not run"], result: "nope" },
    });
    const updates: WorkflowRunUpdate[] = [];

    await withWorkspaces(async (workspaces) => {
      const result = await runWorkflow({
        workflow: plannerWorkflow("split-goal"),
        runtime,
        apiKey: "fake-key",
        workspaces,
        onUpdate(update) {
          updates.push(update);
        },
      });

      expect(result.statuses.planner).toBe("failed");
      const failed = updates.filter((update) => update.nodeId === "planner" && update.status === "failed");
      expect(failed.some((update) => update.log.includes("submit_plan"))).toBe(true);
      expect(runtime.sentPrompts).toHaveLength(1);
      expect(runtime.sentPrompts[0]).toContain("split-goal");
    });
  } finally {
    fetchSpy.mockRestore();
  }
});
