import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { WorkspaceMode } from "@shared/workflow";

export interface WorkspaceProvision {
  id: string;
  mode: WorkspaceMode;
  repositoryPath?: string;
  folderPath?: string;
}

export interface AgentWorkspace {
  id: string;
  mode: WorkspaceMode;
  path: string;
  branch?: string;
  repositoryPath?: string;
}

export interface WorkspaceManager {
  provision(request: WorkspaceProvision): Promise<AgentWorkspace>;
  locate(request: WorkspaceProvision): Promise<AgentWorkspace | null>;
  teardown(workspace: AgentWorkspace): Promise<void>;
  trackChild(workspaceId: string, pid: number): void;
}

const teardownDelaysMs = [50, 150, 500, 2000];
const workspaceIdPattern = /^[A-Za-z0-9._-]+$/;

export function defaultWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SWARMY_WORKSPACES_DIR?.trim();
  if (override) {
    return override;
  }
  const localAppData = env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    throw new Error("Set SWARMY_WORKSPACES_DIR or LOCALAPPDATA for workspaces");
  }
  return join(localAppData, "Swarmy");
}

export function createWorkspaceManager(options?: {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
}): WorkspaceManager {
  return new NodeWorkspaceManager(options?.rootDir ?? defaultWorkspaceRoot(options?.env));
}

class NodeWorkspaceManager implements WorkspaceManager {
  private readonly children = new Map<string, Set<number>>();
  private readonly folderWriters = new Map<string, string>();

  constructor(private readonly rootDir: string) {}

  trackChild(workspaceId: string, pid: number): void {
    this.pids(workspaceId).add(pid);
  }

  async provision(request: WorkspaceProvision): Promise<AgentWorkspace> {
    assertWorkspaceId(request.id);
    if (request.mode === "repo") {
      return this.provisionRepo(request);
    }
    if (request.mode === "managed") {
      return this.provisionManaged(request);
    }
    return this.provisionFolder(request);
  }

  async locate(request: WorkspaceProvision): Promise<AgentWorkspace | null> {
    assertWorkspaceId(request.id);
    if (request.mode === "repo") {
      const path = join(this.rootDir, "wt", request.id);
      if (!(await directoryExists(path))) {
        return null;
      }
      const repositoryPath = request.repositoryPath?.trim();
      return {
        id: request.id,
        mode: "repo",
        path,
        branch: `swarm/${request.id}`,
        ...(repositoryPath ? { repositoryPath: resolve(repositoryPath) } : {}),
      };
    }
    if (request.mode === "managed") {
      const path = join(this.rootDir, "managed", request.id);
      if (!(await directoryExists(path))) {
        return null;
      }
      return { id: request.id, mode: "managed", path };
    }
    const folderPath = request.folderPath?.trim();
    if (!folderPath) {
      return null;
    }
    const path = resolve(folderPath);
    if (!(await directoryExists(path))) {
      return null;
    }
    return { id: request.id, mode: "folder", path };
  }

  async teardown(workspace: AgentWorkspace): Promise<void> {
    if (workspace.mode === "folder") {
      await this.release(workspace.path, workspace.id);
      this.folderWriters.delete(canon(workspace.path));
      this.children.delete(workspace.id);
      return;
    }

    await withBackoff(async () => {
      await this.release(workspace.path, workspace.id);
      if (workspace.mode === "repo") {
        const repositoryPath = workspace.repositoryPath;
        if (!repositoryPath) {
          throw new Error("repo workspace is missing its repository path");
        }
        await this.removeWorktree(workspace.id, repositoryPath, workspace.path);
      }
      await deleteDirectory(workspace.path);
    });
    this.children.delete(workspace.id);
  }

  private async provisionRepo(request: WorkspaceProvision): Promise<AgentWorkspace> {
    const repositoryPath = request.repositoryPath?.trim();
    if (!repositoryPath) {
      throw new Error("repo mode requires a git repository path");
    }
    const resolvedRepo = resolve(repositoryPath);
    await this.assertGitRepo(request.id, resolvedRepo);
    const path = join(this.rootDir, "wt", request.id);
    const branch = `swarm/${request.id}`;
    await mkdir(join(this.rootDir, "wt"), { recursive: true });
    if (!(await directoryExists(path))) {
      await this.runGit(request.id, ["-C", resolvedRepo, "worktree", "add", "-b", branch, path]);
    }
    return {
      id: request.id,
      mode: "repo",
      path,
      branch,
      repositoryPath: resolvedRepo,
    };
  }

  private async provisionManaged(request: WorkspaceProvision): Promise<AgentWorkspace> {
    const path = join(this.rootDir, "managed", request.id);
    await mkdir(path, { recursive: true });
    if (!(await directoryExists(join(path, ".git")))) {
      await this.runGit(request.id, ["-C", path, "init", "-b", "main"]);
    }
    return { id: request.id, mode: "managed", path };
  }

  private async provisionFolder(request: WorkspaceProvision): Promise<AgentWorkspace> {
    const folderPath = request.folderPath?.trim();
    if (!folderPath) {
      throw new Error("folder mode requires a folder path");
    }
    const path = resolve(folderPath);
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      if (isEnoent(error)) {
        throw new Error("folder mode requires a folder path", { cause: error });
      }
      throw error;
    }
    if (!info.isDirectory()) {
      throw new Error("folder mode requires a folder path");
    }
    const key = canon(path);
    const holder = this.folderWriters.get(key);
    if (holder && holder !== request.id) {
      throw new Error("folder mode allows only one writer at a time");
    }
    this.folderWriters.set(key, request.id);
    return { id: request.id, mode: "folder", path };
  }

  private async assertGitRepo(workspaceId: string, repositoryPath: string): Promise<void> {
    let inside: string;
    try {
      inside = (await this.runGit(workspaceId, ["-C", repositoryPath, "rev-parse", "--is-inside-work-tree"])).trim();
    } catch (error) {
      throw new Error("repo mode requires a git repository path", { cause: error });
    }
    if (inside !== "true") {
      throw new Error("repo mode requires a git repository path");
    }
  }

  private async removeWorktree(workspaceId: string, repositoryPath: string, worktreePath: string): Promise<void> {
    try {
      await this.runGit(workspaceId, ["-C", repositoryPath, "worktree", "remove", "--force", worktreePath]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/not a working tree|no such file or directory|not a git repository/i.test(message)) {
        return;
      }
      throw error;
    }
  }

  private async release(workspacePath: string, workspaceId: string): Promise<void> {
    await this.killChildren(workspaceId);
    if (isInside(workspacePath, process.cwd())) {
      process.chdir(tmpdir());
    }
  }

  private async killChildren(workspaceId: string): Promise<void> {
    const pids = [...(this.children.get(workspaceId) ?? [])];
    for (const pid of pids) {
      await taskkill(pid);
      this.children.get(workspaceId)?.delete(pid);
    }
  }

  private pids(workspaceId: string): Set<number> {
    let pids = this.children.get(workspaceId);
    if (!pids) {
      pids = new Set();
      this.children.set(workspaceId, pids);
    }
    return pids;
  }

  private runGit(workspaceId: string, args: string[]): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      const child = spawn("git", args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      if (child.pid) {
        this.trackChild(workspaceId, child.pid);
      }
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const untrack = (): void => {
        if (child.pid) {
          this.children.get(workspaceId)?.delete(child.pid);
        }
      };
      child.on("error", (error) => {
        untrack();
        reject(error);
      });
      child.on("close", (code) => {
        untrack();
        if (code === 0) {
          resolveOutput(stdout);
          return;
        }
        reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
      });
    });
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

function assertWorkspaceId(id: string): void {
  if (!workspaceIdPattern.test(id)) {
    throw new Error("Workspace id must be a simple name");
  }
}

async function deleteDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 0 });
  try {
    await stat(path);
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    throw error;
  }
  throw new Error(`Workspace still exists: ${path}`);
}

async function withBackoff(action: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= teardownDelaysMs.length; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      const delay = teardownDelaysMs[attempt];
      if (delay === undefined) {
        break;
      }
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Workspace teardown failed");
}

function taskkill(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(pid);
    } catch {
      // The child is already gone.
    }
    return Promise.resolve();
  }
  return new Promise((resolveKill) => {
    const child = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      resolveKill();
    });
    child.on("close", () => {
      resolveKill();
    });
  });
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canon(path: string): string {
  return resolve(path).replaceAll("/", "\\").toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
