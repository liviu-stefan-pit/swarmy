import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { EngineMessage } from "@shared/protocol";
import { attachEngine, type EnginePort } from "./engine";
import { FakeRuntime } from "./fake-runtime";
import type { AgentRuntime, CreateAgentRequest } from "./runtime";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Swarmy Test",
  GIT_AUTHOR_EMAIL: "swarmy@example.com",
  GIT_COMMITTER_NAME: "Swarmy Test",
  GIT_COMMITTER_EMAIL: "swarmy@example.com",
};

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

it("runs one agent in a repo worktree and tears it down", async () => {
  root = await mkdtemp(join(tmpdir(), "swarmy-run-ws-"));
  const repo = await initRepo(join(root, "repo"));
  const manager = createWorkspaceManager({ rootDir: join(root, "swarmy") });
  const seen: { cwd: string; status: string; branch: string } = { cwd: "", status: "", branch: "" };
  const runtime = recordingRuntime(seen);
  const posted: EngineMessage[] = [];

  deliverRun(
    {
      type: "run.start",
      id: "run-1",
      nodeId: "agent-1",
      apiKey: "fake-key",
      prompt: "Reply with the single word pong.",
      workspaceMode: "repo",
      repositoryPath: repo,
    },
    runtime,
    manager,
    posted,
  );

  const done = await waitForDone(posted);
  expect(done.status).toBe("completed");
  expect(seen.status).toMatch(/nothing to commit, working tree clean/);
  expect(seen.branch.startsWith("swarm/")).toBe(true);
  expect(canon(seen.cwd)).not.toBe(canon(repo));
  expect(canon(seen.cwd).startsWith(`${canon(join(root, "swarmy", "wt"))}\\`)).toBe(true);
  expect(posted.some((message) => workspacePath(message) === seen.cwd)).toBe(true);
  expect(worktreePaths(await git(repo, ["worktree", "list", "--porcelain"]))).not.toContain(canon(seen.cwd));
  expect(await exists(seen.cwd)).toBe(false);
}, 30_000);

it("fails a repo run that does not name a repository", async () => {
  root = await mkdtemp(join(tmpdir(), "swarmy-run-ws-"));
  const manager = createWorkspaceManager({ rootDir: join(root, "swarmy") });
  const posted: EngineMessage[] = [];
  deliverRun(
    {
      type: "run.start",
      id: "run-2",
      nodeId: "agent-1",
      apiKey: "fake-key",
      prompt: "Reply.",
      workspaceMode: "repo",
    },
    new FakeRuntime({
      accountLabel: "fake@swarmy.local",
      models: [{ id: "fake-model" }],
      helloText: "hi",
      defaultPrompt: { chunks: ["ok"], result: "ok" },
    }),
    manager,
    posted,
  );

  const done = await waitForDone(posted);
  expect(done.status).toBe("failed");
  expect(done.log).toMatch(/repository/i);
});

it("uses a managed git folder when the node does not set a workspace mode", async () => {
  root = await mkdtemp(join(tmpdir(), "swarmy-run-ws-"));
  const manager = createWorkspaceManager({ rootDir: join(root, "swarmy") });
  const seen = { cwd: "" };
  const fake = new FakeRuntime({
    accountLabel: "fake@swarmy.local",
    models: [{ id: "fake-model" }],
    helloText: "hi",
    defaultPrompt: { chunks: ["ok"], result: "ok" },
  });
  const posted: EngineMessage[] = [];
  deliverRun(
    {
      type: "run.start",
      id: "run-3",
      nodeId: "agent-1",
      apiKey: "fake-key",
      prompt: "Reply.",
    },
    {
      account: (apiKey) => fake.account(apiKey),
      models: (apiKey) => fake.models(apiKey),
      hello: (request) => fake.hello(request),
      create(request) {
        seen.cwd = request.cwd;
        return fake.create(request);
      },
    },
    manager,
    posted,
  );

  const done = await waitForDone(posted);
  expect(done.status).toBe("completed");
  expect(canon(seen.cwd).startsWith(`${canon(join(root, "swarmy", "managed"))}\\`)).toBe(true);
  expect(await exists(seen.cwd)).toBe(false);
});

function recordingRuntime(seen: { cwd: string; status: string; branch: string }): AgentRuntime {
  const fake = new FakeRuntime({
    accountLabel: "fake@swarmy.local",
    models: [{ id: "fake-model" }],
    helloText: "hi",
    defaultPrompt: { chunks: ["pong"], result: "pong" },
  });
  return {
    account(apiKey) {
      return fake.account(apiKey);
    },
    models(apiKey) {
      return fake.models(apiKey);
    },
    hello(request) {
      return fake.hello(request);
    },
    async create(request: CreateAgentRequest) {
      seen.cwd = request.cwd;
      try {
        seen.status = await git(request.cwd, ["status"]);
        seen.branch = (await git(request.cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      } catch (error) {
        seen.status = error instanceof Error ? error.message : "git failed";
      }
      return fake.create(request);
    },
  };
}

function deliverRun(
  message: unknown,
  runtime: AgentRuntime,
  workspaces: WorkspaceManager,
  posted: EngineMessage[],
): void {
  let deliver: ((input: unknown) => void) | undefined;
  const port: EnginePort = {
    postMessage(next) {
      posted.push(next);
    },
    onMessage(listener) {
      deliver = listener;
    },
  };
  attachEngine(port, runtime, { workspaces });
  if (!deliver) {
    throw new Error("engine did not subscribe to the port");
  }
  deliver(message);
}

async function waitForDone(
  posted: readonly EngineMessage[],
): Promise<Extract<EngineMessage, { type: "run.done" }>> {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const done = posted.find((message) => message.type === "run.done");
    if (done && done.type === "run.done") {
      return done;
    }
    await new Promise((resolveWait) => {
      setTimeout(resolveWait, 20);
    });
  }
  throw new Error("run did not finish");
}

function workspacePath(message: EngineMessage): string | undefined {
  if (message.type !== "run.update" && message.type !== "run.done") {
    return undefined;
  }
  if (!("workspacePath" in message)) {
    return undefined;
  }
  const value = message.workspacePath;
  return typeof value === "string" ? value : undefined;
}

async function initRepo(path: string): Promise<string> {
  await mkdir(path);
  await git(path, ["init", "-b", "main"]);
  await git(path, ["config", "user.email", "swarmy@example.com"]);
  await git(path, ["config", "user.name", "Swarmy Test"]);
  await git(path, ["config", "core.autocrlf", "false"]);
  await writeFile(join(path, "README.md"), "scratch\n");
  await git(path, ["add", "README.md"]);
  await git(path, ["commit", "-m", "init"]);
  return path;
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
      reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
    });
  });
}

function canon(path: string): string {
  return resolve(path).replaceAll("/", "\\").toLowerCase();
}

function worktreePaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => canon(line.slice("worktree ".length)));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
