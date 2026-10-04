import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import * as orchestrator from "./orchestrator";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import { openSqliteDatabase } from "./sqlite-spike";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
} satisfies Pick<FakeRuntimeScript, "accountLabel" | "models" | "helloText">;

interface WorkflowRunHandle {
  done: Promise<{ statuses: Record<string, string> }>;
  cancel: () => Promise<void>;
}

interface ResumeCall {
  agentId: string;
  systemPrompt?: string;
  tools?: string[];
  mcpServers?: unknown;
}

function agent(
  id: string,
  x: number,
  y: number,
  taskPrompt: string,
  extra?: { systemPrompt?: string; tools?: string[] },
) {
  return {
    id,
    type: "agent" as const,
    position: { x, y },
    data: { label: id, taskPrompt, ...extra },
  };
}

function textEdge(id: string, source: string, target: string) {
  return {
    id,
    source,
    sourceHandle: "text",
    target,
    targetHandle: "text",
  };
}

function lineWorkflow(): Workflow {
  return {
    id: "line",
    name: "Line",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [agent("first", 0, 0, "first-task"), agent("second", 240, 0, "second-task")],
    edges: [textEdge("first-second", "first", "second")],
  };
}

function diamondWorkflow(): Workflow {
  return {
    id: "diamond",
    name: "Diamond",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      agent("source", 0, 0, "source-task"),
      agent("left", 0, 200, "left-task", { systemPrompt: "left-system", tools: ["read"] }),
      agent("right", 240, 200, "right-task"),
      agent("sink", 120, 400, "sink-task"),
    ],
    edges: [
      textEdge("source-left", "source", "left"),
      textEdge("source-right", "source", "right"),
      textEdge("left-sink", "left", "sink"),
      textEdge("right-sink", "right", "sink"),
    ],
  };
}

async function withWorkspaces(run: (workspaces: WorkspaceManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-control-"));
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

function startWorkflowRun(input: {
  workflow: Workflow;
  runtime: FakeRuntime;
  apiKey: string;
  workspaces: WorkspaceManager;
}): WorkflowRunHandle {
  const fn = (orchestrator as { startWorkflowRun?: (input: unknown) => WorkflowRunHandle }).startWorkflowRun;
  if (!fn) {
    throw new Error("startWorkflowRun is not implemented");
  }
  return fn(input);
}

function resumeWorkflow(input: unknown): Promise<{ statuses: Record<string, string> }> {
  const fn = (orchestrator as { resumeWorkflow?: (input: unknown) => Promise<{ statuses: Record<string, string> }> })
    .resumeWorkflow;
  if (!fn) {
    throw new Error("resumeWorkflow is not implemented");
  }
  return fn(input);
}

it("cancelling the run does not start a downstream node that was still queued", async () => {
  const fetchSpy = blockNetwork();
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "first-task": { chunks: ["working"], hold: true, result: "first done" },
    },
    defaultPrompt: { chunks: ["second"], result: "second done" },
  });

  try {
    await withWorkspaces(async (workspaces) => {
      let handle: WorkflowRunHandle | undefined;
      try {
        handle = startWorkflowRun({
          workflow: lineWorkflow(),
          runtime,
          apiKey: "fake-key",
          workspaces,
        });
        await vi.waitFor(() => {
          expect(runtime.sentPrompts.some((prompt) => prompt.includes("first-task"))).toBe(true);
        });
        await handle.cancel();
        const result = await handle.done;
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("second-task"))).toBe(false);
        expect(result.statuses.first).toBe("cancelled");
        expect(result.statuses.second).not.toBe("completed");
      } finally {
        runtime.releaseHeld();
        await handle?.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("resumes a mid-diamond checkpoint without re-running a completed node", async () => {
  const fetchSpy = blockNetwork();
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "source-task": { chunks: ["source"], result: "source done" },
      "left-task": { chunks: ["left"], result: "left done" },
      "right-task": { chunks: ["right"], result: "right done" },
    },
    defaultPrompt: { chunks: ["sink"], result: "sink done" },
  });

  const dir = await mkdtemp(join(tmpdir(), "swarmy-resume-"));
  const dbPath = join(dir, "swarmy.db");
  const checkpointer = SqliteCheckpointer.open(dbPath);

  try {
    await withWorkspaces(async (workspaces) => {
      const threadId = "mid-diamond";
      const partial = {
        workflow: diamondWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
        interruptAfter: ["source"],
      };
      await orchestrator.runWorkflow(partial);

      expect(runtime.sentPrompts.filter((prompt) => prompt.includes("source-task"))).toHaveLength(1);
      expect(runtime.sentPrompts.some((prompt) => prompt.includes("left-task"))).toBe(false);
      expect(runtime.sentPrompts.some((prompt) => prompt.includes("right-task"))).toBe(false);
      expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(false);

      const db = openSqliteDatabase(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS run_agents (
          thread_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          PRIMARY KEY (thread_id, node_id)
        )
      `);
      db.prepare(
        "INSERT OR REPLACE INTO run_agents (thread_id, node_id, agent_id) VALUES (?, ?, ?)",
      ).run(threadId, "left", "agent-left");
      const running = db.prepare(
        "SELECT status FROM workflow_runs WHERE thread_id = ?",
      ).get(threadId);
      db.close();
      expect(running).toMatchObject({ status: "running" });

      const resumed = new FakeRuntime({
        ...baseScript,
        prompts: {
          "source-task": { chunks: ["source"], result: "source done" },
          "left-task": { chunks: ["left"], result: "left done" },
          "right-task": { chunks: ["right"], result: "right done" },
        },
        defaultPrompt: { chunks: ["sink"], result: "sink done" },
      });
      const resumedRuns = resumed as FakeRuntime & { resumes: ResumeCall[] };
      const result = await resumeWorkflow({
        workflow: diamondWorkflow(),
        runtime: resumed,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
      });

      expect(resumed.sentPrompts.some((prompt) => prompt.includes("source-task"))).toBe(false);
      expect(resumed.sentPrompts.some((prompt) => prompt.includes("left-task"))).toBe(true);
      expect(resumed.sentPrompts.some((prompt) => prompt.includes("right-task"))).toBe(true);
      expect(resumed.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(true);
      expect(result.statuses).toMatchObject({
        source: "completed",
        left: "completed",
        right: "completed",
        sink: "completed",
      });
      expect(resumedRuns.resumes).toContainEqual(
        expect.objectContaining({
          agentId: "agent-left",
          systemPrompt: "left-system",
          tools: ["read"],
          mcpServers: {},
        }),
      );
    });
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
