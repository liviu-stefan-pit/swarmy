import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import { startWorkflowRun, type WorkflowRunHandle, type WorkflowRunInput } from "./orchestrator";
import type { CreateAgentRequest, RuntimeAgent } from "./runtime";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const agentText = "agent wrote this\n";
const editedText = "approved word\n";
const rejectedText = "should not land\n";

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
  files?: { path: string; text: string }[];
}

class SeedingRuntime extends FakeRuntime {
  writerPath = "";
  textAtSinkStart = "";
  private seeded = false;

  override async create(request: CreateAgentRequest): Promise<RuntimeAgent> {
    if (request.cwd.endsWith("-writer")) {
      this.writerPath = request.cwd;
      if (!this.seeded) {
        this.seeded = true;
        await writeFile(join(request.cwd, "README.md"), agentText);
      }
    }
    if (request.cwd.endsWith("-sink") && this.writerPath) {
      this.textAtSinkStart = await readFile(join(this.writerPath, "README.md"), "utf8");
    }
    return super.create(request);
  }
}

function gatedWorkflow(): Workflow {
  return {
    id: "diff-review",
    name: "Diff review",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "writer",
        type: "agent",
        position: { x: 0, y: 0 },
        data: { label: "Writer", taskPrompt: "writer-task" },
      },
      {
        id: "review",
        type: "approval",
        position: { x: 280, y: 0 },
        data: { label: "Review" },
      },
      {
        id: "sink",
        type: "agent",
        position: { x: 560, y: 0 },
        data: { label: "Sink", taskPrompt: "sink-task" },
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
  const root = await mkdtemp(join(tmpdir(), "swarmy-diff-review-"));
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

function seedingRuntime(): SeedingRuntime {
  return new SeedingRuntime({
    ...baseScript,
    prompts: {
      "writer-task": { chunks: ["wrote"], result: "wrote the change" },
    },
    defaultPrompt: { chunks: ["sink"], result: "sink done" },
  });
}

function pending(handle: WorkflowRunHandle): PendingApproval[] {
  return handle.pendingApprovals();
}

function decide(handle: WorkflowRunHandle, decision: ApprovalDecision): Promise<void> {
  return handle.decide(decision);
}

it("writes the edited buffer into the worktree before the graph resumes", async () => {
  const fetchSpy = blockNetwork();
  const runtime = seedingRuntime();
  try {
    await withWorkspaces(async (workspaces) => {
      const handle = start({
        workflow: gatedWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
        threadId: "diff-review",
      });
      try {
        await vi.waitFor(() => {
          expect(pending(handle).map((item) => item.nodeId)).toEqual(["review"]);
        });
        expect(JSON.stringify(pending(handle))).toContain("README.md");

        await decide(handle, {
          nodeId: "review",
          action: "approve",
          files: [{ path: "README.md", text: editedText }],
        });
        const result = await handle.done;

        expect(runtime.textAtSinkStart).toBe(editedText);
        expect(await readFile(join(runtime.writerPath, "README.md"), "utf8")).toBe(editedText);
        expect(await git(runtime.writerPath, ["show", "HEAD:README.md"])).toBe(editedText);
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-task") && prompt.includes(editedText))).toBe(
          true,
        );
        expect(result.statuses).toMatchObject({ writer: "completed", review: "completed", sink: "completed" });
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("leaves the worktree file as the agent wrote it when rejected", async () => {
  const fetchSpy = blockNetwork();
  const runtime = seedingRuntime();
  try {
    await withWorkspaces(async (workspaces) => {
      const handle = start({
        workflow: gatedWorkflow(),
        runtime,
        apiKey: "fake-key",
        workspaces,
        threadId: "diff-reject",
      });
      try {
        await vi.waitFor(() => {
          expect(pending(handle)).toHaveLength(1);
        });

        await decide(handle, {
          nodeId: "review",
          action: "reject",
          reason: "try again",
          files: [{ path: "README.md", text: rejectedText }],
        });
        await vi.waitFor(() => {
          expect(pending(handle)).toHaveLength(1);
        });

        expect(await readFile(join(runtime.writerPath, "README.md"), "utf8")).toBe(agentText);
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

function start(input: WorkflowRunInput): WorkflowRunHandle {
  return startWorkflowRun(input);
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveOutput(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
    });
  });
}
