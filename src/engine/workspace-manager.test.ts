import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createWorkspaceManager, defaultWorkspaceRoot, type AgentWorkspace, type WorkspaceManager } from "./workspace-manager";

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Swarmy Test",
  GIT_AUTHOR_EMAIL: "swarmy@example.com",
  GIT_COMMITTER_NAME: "Swarmy Test",
  GIT_COMMITTER_EMAIL: "swarmy@example.com",
};

let root = "";
let repo = "";
let manager: WorkspaceManager | undefined;
const provisioned: AgentWorkspace[] = [];
const sleepers: { pid: number | undefined; kill: () => void }[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarmy-ws-"));
  repo = await initRepo(join(root, "repo"));
  manager = createWorkspaceManager({ rootDir: join(root, "swarmy") });
});

afterEach(async () => {
  for (const sleeper of sleepers) {
    sleeper.kill();
  }
  sleepers.length = 0;
  for (const workspace of provisioned) {
    await manager?.teardown(workspace).catch(() => undefined);
  }
  provisioned.length = 0;
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

it("creates a clean repo worktree on a swarm branch", async () => {
  const workspace = await provision({ id: "agent-a", mode: "repo", repositoryPath: repo });

  expect(workspace.path).toBe(join(root, "swarmy", "wt", "agent-a"));
  expect(resolve(workspace.path)).not.toBe(resolve(repo));
  expect(await git(workspace.path, ["status"])).toMatch(/nothing to commit, working tree clean/);
  expect((await git(workspace.path, ["rev-parse", "--abbrev-ref", "HEAD"])).trim().startsWith("swarm/")).toBe(
    true,
  );
});

it("gives two provisions two directories", async () => {
  const first = await provision({ id: "agent-a", mode: "repo", repositoryPath: repo });
  const second = await provision({ id: "agent-b", mode: "repo", repositoryPath: repo });

  expect(first.path).not.toBe(second.path);
  expect(await exists(first.path)).toBe(true);
  expect(await exists(second.path)).toBe(true);
});

it("teardown removes the worktree from git worktree list", async () => {
  const workspace = await provision({ id: "agent-a", mode: "repo", repositoryPath: repo });

  await currentManager().teardown(workspace);
  forget(workspace);

  const listed = worktreePaths(await git(repo, ["worktree", "list", "--porcelain"]));
  expect(listed).not.toContain(canon(workspace.path));
  expect(await exists(workspace.path)).toBe(false);
});

it("teardown removes a worktree a child process is holding", async () => {
  const workspace = await provision({ id: "agent-a", mode: "repo", repositoryPath: repo });
  const sleeper = spawn(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');const path=require('node:path');fs.openSync(path.join(process.cwd(),'.lock'),'w');setInterval(()=>{},1000);",
    ],
    { cwd: workspace.path, windowsHide: true, stdio: "ignore" },
  );
  sleepers.push({
    pid: sleeper.pid,
    kill() {
      if (sleeper.pid && sleeper.exitCode === null) {
        spawn("taskkill", ["/pid", String(sleeper.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      }
    },
  });
  if (!sleeper.pid) {
    throw new Error("sleeper did not start");
  }
  await waitForFile(join(workspace.path, ".lock"));
  currentManager().trackChild(workspace.id, sleeper.pid);

  await currentManager().teardown(workspace);
  forget(workspace);

  const listed = worktreePaths(await git(repo, ["worktree", "list", "--porcelain"]));
  expect(listed).not.toContain(canon(workspace.path));
  expect(await exists(workspace.path)).toBe(false);
}, 30_000);

it("requires a repository path for repo mode", async () => {
  await expect(currentManager().provision({ id: "agent-a", mode: "repo" })).rejects.toThrow(/repository/i);
});

it("creates a managed folder with git init and deletes it on teardown", async () => {
  const workspace = await provision({ id: "managed-a", mode: "managed" });

  expect(workspace.path).toBe(join(root, "swarmy", "managed", "managed-a"));
  expect((await git(workspace.path, ["rev-parse", "--is-inside-work-tree"])).trim()).toBe("true");

  await currentManager().teardown(workspace);
  forget(workspace);
  expect(await exists(workspace.path)).toBe(false);
});

it("uses a plain folder and leaves it in place after teardown", async () => {
  const folder = join(root, "plain");
  await mkdir(folder);
  await writeFile(join(folder, "keep.txt"), "stay\n");
  const workspace = await provision({ id: "folder-a", mode: "folder", folderPath: folder });

  expect(workspace.path).toBe(folder);
  await currentManager().teardown(workspace);
  forget(workspace);
  expect(await exists(join(folder, "keep.txt"))).toBe(true);
});

it("allows only one writer for a folder", async () => {
  const folder = join(root, "plain");
  await mkdir(folder);
  await provision({ id: "folder-a", mode: "folder", folderPath: folder });

  await expect(
    currentManager().provision({ id: "folder-b", mode: "folder", folderPath: folder }),
  ).rejects.toThrow(/one writer/i);
});

it("places the default workspace root under LOCALAPPDATA\\Swarmy", () => {
  expect(defaultWorkspaceRoot({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" })).toBe(
    join("C:\\Users\\me\\AppData\\Local", "Swarmy"),
  );
});

async function provision(
  request: Parameters<WorkspaceManager["provision"]>[0],
): Promise<AgentWorkspace> {
  const workspace = await currentManager().provision(request);
  provisioned.push(workspace);
  return workspace;
}

function forget(workspace: AgentWorkspace): void {
  const index = provisioned.indexOf(workspace);
  if (index >= 0) {
    provisioned.splice(index, 1);
  }
}

function currentManager(): WorkspaceManager {
  if (!manager) {
    throw new Error("workspace manager was not created");
  }
  return manager;
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
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

async function waitForFile(path: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (await exists(path)) {
      return;
    }
    await new Promise((resolveWait) => {
      setTimeout(resolveWait, 50);
    });
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
