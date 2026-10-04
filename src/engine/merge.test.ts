import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { workflowSchema, type Workflow } from "@shared/workflow";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import { startWorkflowRun, type WorkflowRunHandle } from "./orchestrator";
import type { CreateAgentRequest, RuntimeAgent } from "./runtime";
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

const ancestorFixture = [
  "<<<<<<< HEAD",
  "ours",
  "||||||| ancestor",
  "base",
  "=======",
  "theirs",
  ">>>>>>> swarm/story",
  "",
].join("\n");

interface WrittenFile {
  path: string;
  text: string;
}

class EditingRuntime extends FakeRuntime {
  constructor(
    script: FakeRuntimeScript,
    private readonly filesFor: (prompt: string) => WrittenFile[],
  ) {
    super(script);
  }

  override async create(request: CreateAgentRequest): Promise<RuntimeAgent> {
    const agent = await super.create(request);
    const cwd = request.cwd;
    const filesFor = this.filesFor;
    return {
      agentId: agent.agentId,
      getUsage: () => agent.getUsage(),
      dispose: () => agent.dispose(),
      async send(prompt: string) {
        const files = filesFor(prompt);
        for (const file of files) {
          await writeFile(join(cwd, file.path), file.text);
          await git(cwd, ["add", file.path]);
        }
        if (files.length > 0) {
          await git(cwd, ["commit", "-m", files.map((file) => file.path).join(", ")]);
        }
        return agent.send(prompt);
      },
    };
  }
}

function agent(id: string, x: number, taskPrompt: string) {
  return {
    id,
    type: "agent" as const,
    position: { x, y: 0 },
    data: { label: id, taskPrompt, workspaceMode: "repo" as const },
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

function mergeWorkflow(repositoryPath: string, nodes: unknown[], edges: unknown[]): Workflow {
  return workflowSchema.parse({
    id: "merge-run",
    name: "Merge",
    viewport: { x: 0, y: 0, zoom: 1 },
    repositoryPath,
    nodes,
    edges,
  });
}

function diamond(repositoryPath: string, leftPrompt: string, rightPrompt: string, sinkPrompt: string): Workflow {
  return mergeWorkflow(
    repositoryPath,
    [
      agent("left", 0, leftPrompt),
      agent("right", 0, rightPrompt),
      { id: "combine", type: "merge", position: { x: 280, y: 0 }, data: { label: "Combine" } },
      agent("sink", 560, sinkPrompt),
    ],
    [
      textEdge("left-combine", "left", "combine"),
      textEdge("right-combine", "right", "combine"),
      textEdge("combine-sink", "combine", "sink"),
    ],
  );
}

async function withRepo(
  run: (ctx: { workspaces: WorkspaceManager; repo: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-merge-"));
  const repo = join(root, "repo");
  const workspaces = createWorkspaceManager({ rootDir: join(root, "wt") });
  try {
    await initRepo(repo);
    await run({ workspaces, repo });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function initRepo(repo: string): Promise<void> {
  await mkdir(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "swarmy@example.com"]);
  await git(repo, ["config", "user.name", "Swarmy Test"]);
  await git(repo, ["config", "core.autocrlf", "false"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(repo, "README.md"), "base\n");
  await writeFile(join(repo, "shared.txt"), "base\n");
  await git(repo, ["add", "README.md", "shared.txt"]);
  await git(repo, ["commit", "-m", "init"]);
}

function blockNetwork(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("FakeRuntime must not call the network");
  });
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
      reject(new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`));
    });
  });
}

async function show(repo: string, spec: string): Promise<string | null> {
  try {
    return await git(repo, ["show", spec]);
  } catch {
    return null;
  }
}

async function isAncestor(repo: string, branch: string, target: string): Promise<boolean> {
  try {
    await git(repo, ["merge-base", "--is-ancestor", branch, target]);
    return true;
  } catch {
    return false;
  }
}

function pending(handle: WorkflowRunHandle): { nodeId: string; summary: string; files?: { path: string; modified: string }[] }[] {
  return handle.pendingApprovals();
}

it("merges two worktrees that edit different files, and both edits are in the target", async () => {
  const fetchSpy = blockNetwork();
  const runtime = new EditingRuntime(
    {
      ...baseScript,
      prompts: {
        "left-clean": { chunks: ["left"], result: "left done" },
        "right-clean": { chunks: ["right"], result: "right done" },
      },
      defaultPrompt: { chunks: ["sink"], result: "sink done" },
    },
    (prompt) => {
      if (prompt.includes("left-clean")) return [{ path: "alpha.txt", text: "alpha\n" }];
      if (prompt.includes("right-clean")) return [{ path: "beta.txt", text: "beta\n" }];
      return [];
    },
  );
  try {
    await withRepo(async ({ workspaces, repo }) => {
      const handle = startWorkflowRun({
        workflow: diamond(repo, "left-clean", "right-clean", "sink-clean"),
        runtime,
        apiKey: "fake-key",
        workspaces,
        threadId: "merge-clean",
      });
      try {
        const result = await handle.done;
        const sha = (await git(repo, ["rev-parse", "main"])).trim();
        expect(await show(repo, "main:alpha.txt")).toBe("alpha\n");
        expect(await show(repo, "main:beta.txt")).toBe("beta\n");
        expect(result.statuses).toMatchObject({ left: "completed", right: "completed", combine: "completed", sink: "completed" });
        const sink = runtime.sentPrompts.find((prompt) => prompt.includes("sink-clean"));
        expect(sink).toContain(sha);
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("stops a same-line conflict and does not merge anything past that point", async () => {
  const fetchSpy = blockNetwork();
  const runtime = new EditingRuntime(
    {
      ...baseScript,
      prompts: {
        "left-conflict": { chunks: ["left"], result: "left done" },
        "right-conflict": { chunks: ["right"], result: "right done" },
      },
      defaultPrompt: { chunks: ["sink"], result: "sink done" },
    },
    (prompt) => {
      if (prompt.includes("left-conflict")) {
        return [
          { path: "shared.txt", text: "left\n" },
          { path: "left.txt", text: "from-left\n" },
        ];
      }
      if (prompt.includes("right-conflict")) {
        return [
          { path: "shared.txt", text: "right\n" },
          { path: "right.txt", text: "from-right\n" },
        ];
      }
      return [];
    },
  );
  try {
    await withRepo(async ({ workspaces, repo }) => {
      const handle = startWorkflowRun({
        workflow: diamond(repo, "left-conflict", "right-conflict", "sink-conflict"),
        runtime,
        apiKey: "fake-key",
        workspaces,
        threadId: "merge-conflict",
      });
      try {
        const done = handle.done.then(
          (result) => ({ kind: "done" as const, result }),
          () => ({ kind: "done" as const, result: undefined }),
        );
        const waiting = vi
          .waitFor(
            () => {
              expect(pending(handle).map((item) => item.nodeId)).toEqual(["combine"]);
            },
            { timeout: 20_000, interval: 50 },
          )
          .then(() => ({ kind: "waiting" as const }));
        const outcome = await Promise.race([done, waiting]);
        expect(outcome.kind).toBe("waiting");

        const approval = pending(handle).find((item) => item.nodeId === "combine");
        const conflicted = approval?.files?.find((file) => file.path === "shared.txt");
        expect(conflicted?.modified).toContain("|||||||");
        expect(await show(repo, "main:shared.txt")).toBe("left\n");
        expect(await show(repo, "main:shared.txt")).not.toMatch(/<{7}|\|{7}|={7}|>{7}/);
        expect(await show(repo, "main:left.txt")).toBe("from-left\n");
        expect(await show(repo, "main:right.txt")).toBeNull();
        expect(await isAncestor(repo, "swarm/merge-conflict-left", "main")).toBe(true);
        expect(await isAncestor(repo, "swarm/merge-conflict-right", "main")).toBe(false);
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-conflict"))).toBe(false);
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("treats a fixture file that contains a ||||||| ancestor marker as conflicted", async () => {
  const fetchSpy = blockNetwork();
  const runtime = new EditingRuntime(
    {
      ...baseScript,
      prompts: {
        "story-task": { chunks: ["story"], result: "story done" },
      },
      defaultPrompt: { chunks: ["sink"], result: "sink done" },
    },
    (prompt) => {
      if (prompt.includes("story-task")) return [{ path: "story.txt", text: ancestorFixture }];
      return [];
    },
  );
  try {
    await withRepo(async ({ workspaces, repo }) => {
      const handle = startWorkflowRun({
        workflow: mergeWorkflow(
          repo,
          [
            agent("story", 0, "story-task"),
            { id: "combine", type: "merge", position: { x: 280, y: 0 }, data: { label: "Combine" } },
            agent("sink", 560, "sink-story"),
          ],
          [textEdge("story-combine", "story", "combine"), textEdge("combine-sink", "combine", "sink")],
        ),
        runtime,
        apiKey: "fake-key",
        workspaces,
        threadId: "merge-fixture",
      });
      try {
        const done = handle.done.then(
          (result) => ({ kind: "done" as const, result }),
          () => ({ kind: "done" as const, result: undefined }),
        );
        const waiting = vi
          .waitFor(
            () => {
              expect(pending(handle).map((item) => item.nodeId)).toEqual(["combine"]);
            },
            { timeout: 20_000, interval: 50 },
          )
          .then(() => ({ kind: "waiting" as const }));
        const outcome = await Promise.race([done, waiting]);
        expect(outcome.kind).toBe("waiting");

        const approval = pending(handle).find((item) => item.nodeId === "combine");
        const story = approval?.files?.find((file) => file.path === "story.txt");
        expect(story?.modified).toContain("|||||||");
        expect(await show(repo, "main:story.txt")).toBeNull();
        expect(runtime.sentPrompts.some((prompt) => prompt.includes("sink-story"))).toBe(false);
      } finally {
        await handle.cancel().catch(() => undefined);
        await handle.done.catch(() => undefined);
      }
    });
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);

it("defaults an omitted merge target branch to main and keeps a named one", () => {
  const omitted = workflowSchema.parse({
    id: "merge-doc",
    name: "Merge",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ id: "combine", type: "merge", position: { x: 0, y: 0 }, data: { label: "Combine" } }],
    edges: [],
  });
  const named = workflowSchema.parse({
    id: "merge-doc",
    name: "Merge",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "combine",
        type: "merge",
        position: { x: 0, y: 0 },
        data: { label: "Combine", targetBranch: "release" },
      },
    ],
    edges: [],
  });
  const omittedMerge = omitted.nodes[0];
  const namedMerge = named.nodes[0];
  if (!omittedMerge || omittedMerge.type !== "merge" || !namedMerge || namedMerge.type !== "merge") {
    throw new Error("expected a merge node");
  }
  expect(omittedMerge.data.targetBranch).toBe("main");
  expect(namedMerge.data.targetBranch).toBe("release");
});
