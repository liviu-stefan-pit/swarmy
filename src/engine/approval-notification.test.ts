import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { interruptNotifications } from "@shared/notifications";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import { startWorkflowRun, type WorkflowRunUpdate } from "./orchestrator";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
} satisfies Pick<FakeRuntimeScript, "accountLabel" | "models" | "helloText">;

function gatedWorkflow(): Workflow {
  return {
    id: "gated",
    name: "Gated",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "writer",
        type: "agent",
        position: { x: 0, y: 0 },
        data: { label: "writer", taskPrompt: "writer-task" },
      },
      {
        id: "review",
        type: "approval",
        position: { x: 280, y: 0 },
        data: { label: "Review" },
      },
    ],
    edges: [
      {
        id: "writer-review",
        source: "writer",
        sourceHandle: "diff",
        target: "review",
        targetHandle: "diff",
      },
    ],
  };
}

async function withWorkspaces(run: (workspaces: WorkspaceManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-notify-"));
  const workspaces = createWorkspaceManager({ rootDir: root });
  try {
    await run(workspaces);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("an interrupt produces exactly one notification payload", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("FakeRuntime must not call the network");
  });
  const runtime = new FakeRuntime({
    ...baseScript,
    prompts: {
      "writer-task": { chunks: ["wrote"], result: "wrote the change" },
    },
  });
  const updates: WorkflowRunUpdate[] = [];

  try {
    await withWorkspaces(async (workspaces) => {
      const handle = startWorkflowRun({
        workflow: gatedWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
        onUpdate(update) {
          updates.push(update);
        },
      });
      try {
        await vi.waitFor(() => {
          expect(handle.pendingApprovals().map((item) => item.nodeId)).toEqual(["review"]);
        });
        expect(interruptNotifications(updates)).toEqual([
          {
            title: "Swarmy",
            body: expect.any(String),
            focus: "inbox",
            nodeId: "review",
          },
        ]);
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);
