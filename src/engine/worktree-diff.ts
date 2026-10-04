import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface WorktreeFileDiff {
  path: string;
  original: string;
  modified: string;
}

export interface WorktreeDiff {
  files: WorktreeFileDiff[];
  patch: string;
}

export interface WorktreeEdit {
  path: string;
  text: string;
}

export async function collectWorktreeDiff(cwd: string): Promise<WorktreeDiff> {
  await ignoreAgentStore(cwd);
  const head = await tryGit(cwd, ["rev-parse", "--verify", "HEAD"]);
  const files: WorktreeFileDiff[] = [];
  let patch = "";

  if (head !== null) {
    patch = await git(cwd, ["diff", "--no-ext-diff", "HEAD"]);
    const named = await git(cwd, ["diff", "--name-status", "--no-renames", "HEAD"]);
    for (const row of parseNameStatus(named)) {
      const status = row.status.slice(0, 1);
      if (status === "D") {
        const original = (await tryGit(cwd, ["show", `HEAD:${row.path}`])) ?? "";
        files.push({ path: row.path, original, modified: "" });
        continue;
      }
      const original = status === "A" ? "" : ((await tryGit(cwd, ["show", `HEAD:${row.path}`])) ?? "");
      const modified = await readText(resolve(cwd, ...row.path.split("/")));
      files.push({ path: row.path, original, modified });
    }
  }

  const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  const extras: string[] = [];
  for (const row of untracked.split(/\r?\n/)) {
    const path = row.replaceAll("\\", "/").trim();
    if (path.length === 0 || files.some((file) => file.path === path)) {
      continue;
    }
    const modified = await readText(resolve(cwd, ...path.split("/")));
    files.push({ path, original: "", modified });
    extras.push(untrackedPatch(path, modified));
  }

  if (extras.length > 0) {
    const body = extras.join("");
    patch = patch.length > 0 ? `${patch.endsWith("\n") ? patch : `${patch}\n`}${body}` : body;
  }

  return { files, patch };
}

export async function commitReviewedEdits(cwd: string, edits: readonly WorktreeEdit[]): Promise<string[]> {
  await ignoreAgentStore(cwd);
  const written: string[] = [];
  for (const edit of edits) {
    const relativePath = safeRelative(edit.path);
    const full = resolveInside(cwd, relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, edit.text);
    written.push(relativePath);
  }

  const status = await git(cwd, ["status", "--porcelain"]);
  if (status.trim().length === 0) {
    return written;
  }

  await git(cwd, ["add", "-A"]);
  await git(cwd, [
    "-c",
    "user.name=Swarmy",
    "-c",
    "user.email=swarmy@local",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Approve reviewed diff",
  ]);
  return written;
}

function untrackedPatch(path: string, modified: string): string {
  const lines = modified.length === 0 ? [] : modified.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const body = lines.map((line) => `+${line}`).join("\n");
  const count = lines.length;
  return `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${count} @@\n${body}${body.length > 0 ? "\n" : ""}`;
}

function parseNameStatus(text: string): { status: string; path: string }[] {
  const rows: { status: string; path: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    const path = (parts[parts.length - 1] ?? "").replaceAll("\\", "/");
    if (status.length === 0 || path.length === 0) {
      continue;
    }
    rows.push({ status, path });
  }
  return rows;
}

export function safeRelative(input: string): string {
  const path = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (path.length === 0 || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) {
    throw new Error(`Edited path escapes the worktree: ${input}`);
  }
  return path;
}

function resolveInside(root: string, relativePath: string): string {
  const full = resolve(root, ...relativePath.split("/"));
  const rel = relative(resolve(root), full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Edited path escapes the worktree: ${relativePath}`);
  }
  return full;
}

async function ignoreAgentStore(cwd: string): Promise<void> {
  const gitPath = (await git(cwd, ["rev-parse", "--git-path", "info/exclude"])).trim();
  const full = isAbsolute(gitPath) ? gitPath : resolve(cwd, gitPath);
  await mkdir(dirname(full), { recursive: true });
  let current = "";
  try {
    current = await readFile(full, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }
  if (current.split(/\r?\n/).includes("agent-store/")) {
    return;
  }
  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  await writeFile(full, `${prefix}agent-store/\n`);
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[]): Promise<string> {
  const command = subcommand(args);
  const ok = command === "diff" ? new Set([0, 1]) : new Set([0]);
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", ["--no-pager", "-c", "core.quotepath=false", ...args], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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
      if (code !== null && ok.has(code)) {
        resolveOutput(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
    });
  });
}

function subcommand(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "-c" || arg === "--config") {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return arg;
  }
  return "";
}
