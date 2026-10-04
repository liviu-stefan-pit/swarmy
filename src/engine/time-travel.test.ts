import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import { forkRun, listRunCheckpoints, resumeWorkflow, runWorkflow } from "./orchestrator";
import type { AgentRuntime, CreateAgentRequest, RuntimeAgent } from "./runtime";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Swarmy Test",
  GIT_AUTHOR_EMAIL: "swarmy@example.com",
  GIT_COMMITTER_NAME: "Swarmy Test",
  GIT_COMMITTER_EMAIL: "swarmy@example.com",
};

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
} satisfies Pick<FakeRuntimeScript, "accountLabel" | "models" | "helloText">;

function agent(id: string, x: number, taskPrompt: string, label: string, workspaceMode?: "repo") {
  return {
    id,
    type: "agent" as const,
    position: { x, y: 0 },
    data: {
      label,
      taskPrompt,
      ...(workspaceMode ? { workspaceMode } : {}),
    },
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

function lineWorkflow(repositoryPath?: string): Workflow {
  return {
    id: "line",
    name: "Line",
    viewport: { x: 0, y: 0, zoom: 1 },
    ...(repositoryPath ? { repositoryPath } : {}),
    nodes: [
      agent("first", 0, "first-task", "First", repositoryPath ? "repo" : undefined),
      agent("second", 240, "second-task", "Second", repositoryPath ? "repo" : undefined),
      agent("third", 480, "third-task", "Third", repositoryPath ? "repo" : undefined),
    ],
    edges: [textEdge("first-second", "first", "second"), textEdge("second-third", "second", "third")],
  };
}

function lineScript(): FakeRuntimeScript {
  return {
    ...baseScript,
    prompts: {
      "first-task": { chunks: ["first"], result: "first done" },
      "second-task": { chunks: ["second"], result: "second done" },
      "third-task": { chunks: ["third"], result: "third done" },
    },
  };
}

async function withWorkspaces(run: (workspaces: WorkspaceManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-travel-"));
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

function committingRuntime(inner: FakeRuntime): AgentRuntime {
  return {
    account: (apiKey) => inner.account(apiKey),
    models: (apiKey) => inner.models(apiKey),
    hello: (request) => inner.hello(request),
    usageForAgent: (apiKey, agentId) => inner.usageForAgent(apiKey, agentId),
    create: (request) => committingAgent(inner, request),
    resume: async (request) => {
      inner.resumes.push(request);
      return committingAgent(inner, request);
    },
  };
}

async function committingAgent(inner: FakeRuntime, request: CreateAgentRequest): Promise<RuntimeAgent> {
  const agent = await inner.create(request);
  return {
    agentId: agent.agentId,
    getUsage: () => agent.getUsage(),
    dispose: () => agent.dispose(),
    async send(prompt: string) {
      const name = fileForPrompt(prompt);
      await writeFile(join(request.cwd, name), `${name}\n`);
      await git(request.cwd, ["add", name]);
      await git(request.cwd, ["commit", "-m", name]);
      return agent.send(prompt);
    },
  };
}

function fileForPrompt(prompt: string): string {
  if (prompt.includes("first-task")) {
    return "first.txt";
  }
  if (prompt.includes("second-task")) {
    return "second.txt";
  }
  return "third.txt";
}

async function initRepo(path: string): Promise<void> {
  await mkdir(path);
  await git(path, ["init", "-b", "main"]);
  await git(path, ["config", "user.email", "swarmy@example.com"]);
  await git(path, ["config", "user.name", "Swarmy Test"]);
  await git(path, ["config", "core.autocrlf", "false"]);
  await writeFile(join(path, "README.md"), "scratch\n");
  await git(path, ["add", "README.md"]);
  await git(path, ["commit", "-m", "init"]);
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: gitEnv,
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
      reject(new Error(stderr || stdout || `git exited ${code ?? "unknown"}`));
    });
  });
}

it("lists three checkpoints in the order the fake nodes completed", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-checkpoints-"));
  const checkpointer = SqliteCheckpointer.open(join(dir, "swarmy.db"));
  try {
    await withWorkspaces(async (workspaces) => {
      const workflow = lineWorkflow();
      const threadId = "line-three";
      await runWorkflow({
        workflow,
        runtime: new FakeRuntime(lineScript()),
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
      });

      const checkpoints = await listRunCheckpoints({ workflow, checkpointer, threadId });
      expect(checkpoints.map((checkpoint) => checkpoint.nodeId)).toEqual(["first", "second", "third"]);
      expect(checkpoints.map((checkpoint) => checkpoint.label)).toEqual(["First", "Second", "Third"]);
      expect(checkpoints[0]?.time <= (checkpoints[1]?.time ?? "")).toBe(true);
      expect(checkpoints[1]?.time <= (checkpoints[2]?.time ?? "")).toBe(true);
    });
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

it("forks at the second checkpoint onto a new run whose next node is the third", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-fork-"));
  const checkpointer = SqliteCheckpointer.open(join(dir, "swarmy.db"));
  const runtime = new FakeRuntime(lineScript());
  try {
    await withWorkspaces(async (workspaces) => {
      const workflow = lineWorkflow();
      const threadId = "line-fork";
      await runWorkflow({
        workflow,
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
      });
      const before = await listRunCheckpoints({ workflow, checkpointer, threadId });
      const second = before[1];
      expect(second?.nodeId).toBe("second");

      const forked = await forkRun({
        workflow,
        workspaces,
        checkpointer,
        threadId,
        checkpointId: second?.checkpointId ?? "",
      });

      expect(forked.threadId).not.toBe(threadId);
      expect(forked.nextNodeId).toBe("third");
      expect(forked.statuses).toMatchObject({
        first: "completed",
        second: "completed",
        third: "idle",
      });
      expect(runtime.sentPrompts.filter((prompt) => prompt.includes("second-task"))).toHaveLength(1);
      expect(runtime.sentPrompts.filter((prompt) => prompt.includes("third-task"))).toHaveLength(1);

      const original = await listRunCheckpoints({ workflow, checkpointer, threadId });
      expect(original.map((checkpoint) => checkpoint.checkpointId)).toEqual(
        before.map((checkpoint) => checkpoint.checkpointId),
      );

      const resumed = new FakeRuntime(lineScript());
      const result = await resumeWorkflow({
        workflow,
        runtime: resumed,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId: forked.threadId,
      });
      expect(resumed.sentPrompts.some((prompt) => prompt.includes("second-task"))).toBe(false);
      expect(resumed.sentPrompts.some((prompt) => prompt.includes("third-task"))).toBe(true);
      expect(resumed.sentPrompts.some((prompt) => prompt.includes("first-task"))).toBe(false);
      expect(result.statuses.third).toBe("completed");
      expect(result.statuses.second).toBe("completed");
    });
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

it("checks the worktree out at the commit stored on the forked checkpoint", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-sha-"));
  const repo = join(dir, "repo");
  const checkpointer = SqliteCheckpointer.open(join(dir, "swarmy.db"));
  try {
    await initRepo(repo);
    await withWorkspaces(async (workspaces) => {
      const workflow = lineWorkflow(repo);
      const threadId = "line-sha";
      await runWorkflow({
        workflow,
        runtime: committingRuntime(new FakeRuntime(lineScript())),
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
      });

      const checkpoints = await listRunCheckpoints({ workflow, checkpointer, threadId });
      const second = checkpoints[1];
      expect(second?.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(checkpoints[0]?.workspacePath).toBe(second?.workspacePath);
      expect(checkpoints[2]?.workspacePath).toBe(second?.workspacePath);
      expect(checkpoints[2]?.commitSha).not.toBe(second?.commitSha);
      const workspacePath = second?.workspacePath ?? "";
      expect(workspacePath.length).toBeGreaterThan(0);

      await writeFile(join(workspacePath, "later.txt"), "later\n");
      await git(workspacePath, ["add", "later.txt"]);
      await git(workspacePath, ["commit", "-m", "later"]);
      const moved = (await git(workspacePath, ["rev-parse", "HEAD"])).trim();
      expect(moved).not.toBe(second?.commitSha);

      await forkRun({
        workflow,
        workspaces,
        checkpointer,
        threadId,
        checkpointId: second?.checkpointId ?? "",
      });

      const head = (await git(workspacePath, ["rev-parse", "HEAD"])).trim();
      expect(head).toBe(second?.commitSha);
    });
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
