import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import { runWorkflow } from "./orchestrator";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import { openSqliteDatabase } from "./sqlite-spike";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
} satisfies Pick<FakeRuntimeScript, "accountLabel" | "models" | "helloText">;

function agent(id: string, x: number, taskPrompt: string) {
  return {
    id,
    type: "agent" as const,
    position: { x, y: 0 },
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

function oneAgent(id: string, taskPrompt: string): Workflow {
  return {
    id,
    name: id,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [agent("solo", 0, taskPrompt)],
    edges: [],
  };
}

function twoAgentLine(id: string, budgetTokens: number): Workflow {
  return {
    id,
    name: id,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [agent("first", 0, "first-task"), agent("second", 240, "second-task")],
    edges: [textEdge("first-second", "first", "second")],
    budgetTokens,
  };
}

async function withWorkspaces(run: (workspaces: WorkspaceManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-obs-ws-"));
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

function nodeRow(dbPath: string, threadId: string, nodeId: string): {
  total_tokens: number | null;
  cost_state: string;
  charged_cents: number | null;
} {
  const db = openSqliteDatabase(dbPath);
  try {
    const row: unknown = db
      .prepare(
        `SELECT total_tokens, cost_state, charged_cents
         FROM run_nodes
         WHERE thread_id = ? AND node_id = ?`,
      )
      .get(threadId, nodeId);
    if (!isNodeRow(row)) {
      throw new Error(`No node row for ${nodeId}`);
    }
    return row;
  } finally {
    db.close();
  }
}

function runStatus(dbPath: string, threadId: string): string {
  const db = openSqliteDatabase(dbPath);
  try {
    const row: unknown = db.prepare("SELECT status FROM workflow_runs WHERE thread_id = ?").get(threadId);
    if (!isStatusRow(row)) {
      throw new Error(`No run row for ${threadId}`);
    }
    return row.status;
  } finally {
    db.close();
  }
}

function isNodeRow(value: unknown): value is {
  total_tokens: number | null;
  cost_state: string;
  charged_cents: number | null;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  const tokens = row.total_tokens;
  const cents = row.charged_cents;
  return (
    typeof row.cost_state === "string" &&
    (tokens === null || typeof tokens === "number") &&
    (cents === null || typeof cents === "number")
  );
}

function isStatusRow(value: unknown): value is { status: string } {
  return typeof value === "object" && value !== null && typeof (value as { status?: unknown }).status === "string";
}

it("stores token usage from a fake run on the node row", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-obs-"));
  const dbPath = join(dir, "swarmy.db");
  const checkpointer = SqliteCheckpointer.open(dbPath);
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "solo-task": { chunks: ["counted"], result: "counted", usage: { totalTokens: 10 } },
    },
  });

  try {
    await withWorkspaces(async (workspaces) => {
      await runWorkflow({
        workflow: oneAgent("usage-workflow", "solo-task"),
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId: "usage-run",
      });
    });

    expect(nodeRow(dbPath, "usage-run", "solo").total_tokens).toBe(10);
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it("stores a missing cost as pending, not zero", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-obs-"));
  const dbPath = join(dir, "swarmy.db");
  const checkpointer = SqliteCheckpointer.open(dbPath);
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "solo-task": { chunks: ["no cost yet"], result: "no cost yet", usage: { totalTokens: 4 } },
    },
  });

  try {
    await withWorkspaces(async (workspaces) => {
      await runWorkflow({
        workflow: oneAgent("pending-workflow", "solo-task"),
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId: "pending-run",
      });
    });

    const row = nodeRow(dbPath, "pending-run", "solo");
    expect(row.cost_state).toBe("pending");
    expect(row.charged_cents).toBeNull();
    expect(row.charged_cents).not.toBe(0);
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it("cancels remaining nodes when reported tokens exceed the token budget", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-obs-"));
  const dbPath = join(dir, "swarmy.db");
  const checkpointer = SqliteCheckpointer.open(dbPath);
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "first-task": { chunks: ["spent"], result: "spent", usage: { totalTokens: 8 } },
      "second-task": { chunks: ["should not run"], result: "should not run" },
    },
  });

  try {
    await withWorkspaces(async (workspaces) => {
      const result = await runWorkflow({
        workflow: twoAgentLine("budget-workflow", 5),
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId: "budget-run",
      });

      expect(runtime.sentPrompts.some((prompt) => prompt.includes("second-task"))).toBe(false);
      expect(result.statuses.second).toBe("cancelled");
      expect(result.statuses.first).toBe("completed");
      expect(result.budgetNote).toBe("Budget exceeded.");
    });

    const row = nodeRow(dbPath, "budget-run", "first");
    expect(row.total_tokens).toBe(8);
    expect(row.cost_state).toBe("pending");
    expect(row.charged_cents).toBeNull();
    expect(runStatus(dbPath, "budget-run")).toBe("budget_exceeded");
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps the next agent when the cost is pending and tokens are under the budget", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-obs-"));
  const dbPath = join(dir, "swarmy.db");
  const checkpointer = SqliteCheckpointer.open(dbPath);
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "first-task": { chunks: ["spent"], result: "spent", usage: { totalTokens: 8 } },
      "second-task": { chunks: ["still going"], result: "still going" },
    },
  });

  try {
    await withWorkspaces(async (workspaces) => {
      const result = await runWorkflow({
        workflow: twoAgentLine("pending-budget", 100),
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId: "pending-budget-run",
      });

      expect(runtime.sentPrompts.some((prompt) => prompt.includes("second-task"))).toBe(true);
      expect(result.statuses.second).toBe("completed");
      expect(result.statuses.first).toBe("completed");
    });

    const row = nodeRow(dbPath, "pending-budget-run", "first");
    expect(row.cost_state).toBe("pending");
    expect(row.charged_cents).toBeNull();
    expect(runStatus(dbPath, "pending-budget-run")).toBe("completed");
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps the next agent when a token budget is set but usage was not reported", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-obs-"));
  const dbPath = join(dir, "swarmy.db");
  const checkpointer = SqliteCheckpointer.open(dbPath);
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "first-task": { chunks: ["no usage"], result: "no usage" },
      "second-task": { chunks: ["still going"], result: "still going" },
    },
  });

  try {
    await withWorkspaces(async (workspaces) => {
      const result = await runWorkflow({
        workflow: twoAgentLine("missing-tokens", 5),
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId: "missing-tokens-run",
      });

      expect(runtime.sentPrompts.some((prompt) => prompt.includes("second-task"))).toBe(true);
      expect(result.statuses.second).toBe("completed");
    });

    expect(nodeRow(dbPath, "missing-tokens-run", "first").total_tokens).toBeNull();
    expect(runStatus(dbPath, "missing-tokens-run")).toBe("completed");
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
