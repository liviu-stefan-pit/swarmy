import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import * as orchestrator from "./orchestrator";
import type { WorkflowRunHandle, WorkflowRunInput } from "./orchestrator";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
} satisfies Pick<FakeRuntimeScript, "accountLabel" | "models" | "helloText">;

interface PendingApproval {
  nodeId: string;
  summary: string;
}

interface ApprovalDecision {
  nodeId: string;
  action: "approve" | "reject";
  reason?: string;
}

function agent(id: string, x: number, y: number, taskPrompt: string) {
  return {
    id,
    type: "agent" as const,
    position: { x, y },
    data: { label: id, taskPrompt },
  };
}

function gatedWorkflow(): Workflow {
  return {
    id: "gated",
    name: "Gated",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      agent("writer", 0, 0, "writer-task"),
      {
        id: "review",
        type: "approval",
        position: { x: 280, y: 0 },
        data: { label: "Review" },
      },
      agent("sink", 560, 0, "sink-task"),
    ],
    edges: [
      {
        id: "writer-review",
        source: "writer",
        sourceHandle: "diff",
        target: "review",
        targetHandle: "diff",
      },
      {
        id: "review-sink",
        source: "review",
        sourceHandle: "diff",
        target: "sink",
        targetHandle: "diff",
      },
    ],
  };
}

async function withWorkspaces(run: (workspaces: WorkspaceManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-approval-"));
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

function writerRuntime(): FakeRuntime {
  return new FakeRuntime({
    ...baseScript,
    prompts: {
      "writer-task": { chunks: ["wrote"], result: "wrote the change" },
    },
    defaultPrompt: { chunks: ["sink"], result: "sink done" },
  });
}

function start(input: WorkflowRunInput): WorkflowRunHandle {
  return orchestrator.startWorkflowRun(input);
}

function pending(handle: WorkflowRunHandle): PendingApproval[] {
  const fn = (handle as { pendingApprovals?: () => PendingApproval[] }).pendingApprovals;
  if (!fn) {
    throw new Error("pendingApprovals is not implemented");
  }
  return fn.call(handle);
}

function decide(handle: WorkflowRunHandle, decision: ApprovalDecision): Promise<void> {
  const fn = (handle as { decide?: (decision: ApprovalDecision) => Promise<void> }).decide;
  if (!fn) {
    throw new Error("decide is not implemented");
  }
  return fn.call(handle, decision);
}

function listPending(input: {
  workflow: Workflow;
  checkpointer: SqliteCheckpointer;
  threadId: string;
}): Promise<PendingApproval[]> {
  const fn = (orchestrator as { listPendingApprovals?: (input: unknown) => Promise<PendingApproval[]> })
    .listPendingApprovals;
  if (!fn) {
    throw new Error("listPendingApprovals is not implemented");
  }
  return fn(input);
}

it("does not start the sink until the approval is approved", async () => {
  const fetchSpy = blockNetwork();
  const runtime = writerRuntime();
  try {
    await withWorkspaces(async (workspaces) => {
      const handle = start({
        workflow: gatedWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
      });
      try {
        await vi.waitFor(() => {
          expect(pending(handle).map((item) => item.nodeId)).toEqual(["review"]);
        });
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("writer-task"))).toBe(true);
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(false);

        await decide(handle, { nodeId: "review", action: "approve" });
        const result = await handle.done;
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(true);
        expect(result.statuses).toMatchObject({
          writer: "completed",
          review: "completed",
          sink: "completed",
        });
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("reruns the upstream agent once when rejected with try again, then interrupts again", async () => {
  const fetchSpy = blockNetwork();
  const runtime = writerRuntime();
  try {
    await withWorkspaces(async (workspaces) => {
      const handle = start({
        workflow: gatedWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
      });
      try {
        await vi.waitFor(() => {
          expect(pending(handle)).toHaveLength(1);
        });
        expect(runtime.sentPrompts.filter((prompt) => prompt.includes("writer-task"))).toHaveLength(1);

        await decide(handle, { nodeId: "review", action: "reject", reason: "try again" });
        await vi.waitFor(() => {
          const writer = runtime.sentPrompts.filter((prompt) => prompt.includes("writer-task"));
          expect(writer).toHaveLength(2);
          expect(pending(handle)).toHaveLength(1);
        });

        const writer = runtime.sentPrompts.filter((prompt) => prompt.includes("writer-task"));
        expect(writer[1]).toContain("try again");
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(false);
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("fails the branch on the fourth reject instead of looping", async () => {
  const fetchSpy = blockNetwork();
  const runtime = writerRuntime();
  const reviewLogs: string[] = [];
  try {
    await withWorkspaces(async (workspaces) => {
      const handle = start({
        workflow: gatedWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
        onUpdate(update) {
          if (update.nodeId === "review") {
            reviewLogs.push(update.log);
          }
        },
      });
      try {
        for (const reason of ["one", "two", "three", "four"]) {
          await vi.waitFor(() => {
            expect(pending(handle)).toHaveLength(1);
          });
          await decide(handle, { nodeId: "review", action: "reject", reason });
        }
        const result = await handle.done;
        expect(runtime.sentPrompts.filter((prompt) => prompt.includes("writer-task"))).toHaveLength(4);
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(false);
        expect(result.statuses.review).toBe("failed");
        expect(result.statuses.sink).not.toBe("completed");
        expect(reviewLogs.join("\n")).toMatch(/3/);
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("leaves the interrupt pending so a restarted run can approve it", async () => {
  const fetchSpy = blockNetwork();
  const runtime = writerRuntime();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-approval-restart-"));
  const checkpointer = SqliteCheckpointer.open(join(dir, "swarmy.db"));
  const threadId = "approval-restart";
  try {
    await withWorkspaces(async (workspaces) => {
      const workflow = gatedWorkflow();
      const handle = start({
        workflow,
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
      });
      try {
        await vi.waitFor(() => {
          expect(pending(handle)).toHaveLength(1);
        });
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(false);

        const listed = await listPending({ workflow, checkpointer, threadId });
        expect(listed.map((item) => item.nodeId)).toEqual(["review"]);

        const resumed = writerRuntime();
        const continued = start({
          workflow,
          runtime: resumed,
          apiKey: "fake-key",
          workspaces,
          checkpointer,
          threadId,
          resume: true,
          ...{ decision: { nodeId: "review", action: "approve" } },
        } as WorkflowRunInput);
        const result = await continued.done;
        expect(resumed.sentPrompts.some((prompt) => prompt.includes("writer-task"))).toBe(false);
        expect(resumed.sentPrompts.some((prompt) => prompt.includes("sink-task"))).toBe(true);
        expect(result.statuses).toMatchObject({
          writer: "completed",
          review: "completed",
          sink: "completed",
        });
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
