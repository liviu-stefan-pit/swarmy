import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime, type FakePromptScript, type FakeRuntimeScript } from "./fake-runtime";
import { runWorkflow } from "./orchestrator";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
} satisfies Pick<FakeRuntimeScript, "accountLabel" | "models" | "helloText">;

function agent(id: string, x: number, y: number, taskPrompt: string) {
  return {
    id,
    type: "agent" as const,
    position: { x, y },
    data: { label: id, taskPrompt },
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

function diamondWorkflow(): Workflow {
  return {
    id: "diamond",
    name: "Diamond",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      agent("source", 0, 0, "source-task"),
      agent("left", 0, 200, "left-task"),
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

function cycleWorkflow(): Workflow {
  return {
    id: "cycle",
    name: "Cycle",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [agent("alpha", 0, 0, "alpha-task"), agent("beta", 240, 0, "beta-task")],
    edges: [textEdge("alpha-beta", "alpha", "beta"), textEdge("beta-alpha", "beta", "alpha")],
  };
}

async function withWorkspaces(
  run: (workspaces: WorkspaceManager) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-orch-"));
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

it("overlaps the two middle agents of a diamond", async () => {
  const fetchSpy = blockNetwork();
  try {
    const runtime = new FakeRuntime({
      ...baseScript,
      prompts: {
        "source-task": { chunks: ["source"], result: "source done" },
        "left-task": { chunks: ["left"], hold: true, result: "left done" },
        "right-task": { chunks: ["right"], hold: true, result: "right done" },
      },
      defaultPrompt: { chunks: ["sink"], result: "sink done" },
    });

    await withWorkspaces(async (workspaces) => {
      const pending = runWorkflow({
        workflow: diamondWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
      });

      await vi.waitFor(() => {
        const started = runtime.sentPrompts.filter(
          (prompt) => prompt.includes("left-task") || prompt.includes("right-task"),
        );
        expect(started).toHaveLength(2);
      });

      const finishedMiddles = runtime.finishedPrompts.filter(
        (prompt) => prompt.includes("left-task") || prompt.includes("right-task"),
      );
      expect(finishedMiddles).toHaveLength(0);

      runtime.releaseHeld();
      const result = await pending;
      expect(result.statuses).toMatchObject({
        source: "completed",
        left: "completed",
        right: "completed",
        sink: "completed",
      });
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("gives the sink the upstream summaries and omits chain of thought", async () => {
  const fetchSpy = blockNetwork();
  try {
    const handoff = (summary: string, secret: string): FakePromptScript => ({
      chunks: ["working"],
      result: "assistant text",
      handoff: {
        summary,
        files: [`${summary}.txt`],
        blockers: [],
        chainOfThought: secret,
      },
    });
    const runtime = new FakeRuntime({
      ...baseScript,
      prompts: {
        "source-task": handoff("source summary", "secret-source"),
        "left-task": handoff("left summary", "secret-left"),
        "right-task": handoff("right summary", "secret-right"),
      },
      defaultPrompt: { chunks: ["sink reply"], result: "sink reply" },
    });

    await withWorkspaces(async (workspaces) => {
      await runWorkflow({
        workflow: diamondWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
      });
    });

    const sink = runtime.sentPrompts.find((prompt) => prompt.includes("sink-task"));
    expect(sink).toBeDefined();
    expect(sink).toContain("left summary");
    expect(sink).toContain("right summary");
    expect(sink).not.toContain("secret-left");
    expect(sink).not.toContain("secret-right");
    expect(sink).not.toContain("secret-source");
    expect(sink).not.toContain("chainOfThought");
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("fails the sink when one middle fails and still completes the other middle", async () => {
  const fetchSpy = blockNetwork();
  try {
    const runtime = new FakeRuntime({
      ...baseScript,
      prompts: {
        "source-task": { chunks: ["ok"], result: "ok" },
        "left-task": { chunks: ["no"], status: "error", error: "left exploded" },
        "right-task": { chunks: ["yes"], result: "yes" },
      },
      defaultPrompt: { chunks: ["sink"], result: "sink" },
    });

    await withWorkspaces(async (workspaces) => {
      const result = await runWorkflow({
        workflow: diamondWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
      });
      expect(result.statuses.left).toBe("failed");
      expect(result.statuses.right).toBe("completed");
      expect(result.statuses.sink).toBe("failed");
      expect(result.statuses.source).toBe("completed");
    });

    expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(false);
    expect(runtime.sentPrompts.some((prompt) => prompt.includes("right-task"))).toBe(true);
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("rejects a cycle before any agent starts", async () => {
  const fetchSpy = blockNetwork();
  try {
    const runtime = new FakeRuntime({
      ...baseScript,
      defaultPrompt: { chunks: ["nope"], result: "nope" },
    });

    await withWorkspaces(async (workspaces) => {
      await expect(
        runWorkflow({
          workflow: cycleWorkflow(),
          runtime,
          apiKey: "fake-key",
          workspaces,
        }),
      ).rejects.toThrow(/Cycle/);
    });

    expect(runtime.sentPrompts).toEqual([]);
  } finally {
    fetchSpy.mockRestore();
  }
});
