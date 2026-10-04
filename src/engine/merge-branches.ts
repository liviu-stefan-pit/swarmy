import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { commitReviewedEdits } from "./worktree-diff";

const conflictMarker = /^(?:<{7}|\|{7}|={7}|>{7})(?: |$)/m;

export interface MergeConflictFile {
  path: string;
  original: string;
  modified: string;
}

export type MergeBranchResult =
  | { status: "merged"; sha: string }
  | { status: "conflict"; files: MergeConflictFile[] };

export function hasConflictMarkers(text: string): boolean {
  return conflictMarker.test(text);
}

export async function prepareMergeTarget(repositoryPath: string, targetBranch: string): Promise<void> {
  const inside = (await gitOk(repositoryPath, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") {
    throw new Error("Merge needs the workflow's git repository.");
  }
  const status = await gitOk(repositoryPath, ["status", "--porcelain"]);
  if (status.trim().length > 0) {
    throw new Error(`Commit or stash changes in the repository before merging into ${targetBranch}.`);
  }
  const head = (await gitOk(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (head === targetBranch) {
    return;
  }
  const checkout = await gitResult(repositoryPath, ["checkout", targetBranch]);
  if (checkout.code !== 0) {
    throw new Error(
      checkout.stderr.trim() || `The target branch ${targetBranch} could not be checked out.`,
    );
  }
}

export async function mergeBranch(repositoryPath: string, branch: string): Promise<MergeBranchResult> {
  const before = (await gitOk(repositoryPath, ["rev-parse", "HEAD"])).trim();
  try {
    const merged = await gitResult(repositoryPath, [
      "-c",
      "merge.conflictStyle=diff3",
      "-c",
      "rerere.enabled=false",
      "-c",
      "user.name=Swarmy",
      "-c",
      "user.email=swarmy@local",
      "-c",
      "commit.gpgsign=false",
      "merge",
      "--no-edit",
      branch,
    ]);
    if (merged.code !== 0) {
      const unmerged = await unmergedPaths(repositoryPath);
      if (unmerged.length === 0 && !(await hasMergeHead(repositoryPath))) {
        throw new Error(merged.stderr.trim() || merged.stdout.trim() || "The merge failed");
      }
      return { status: "conflict", files: await filesFromWorktree(repositoryPath, before, unmerged) };
    }

    const marked = await filesWithMarkers(repositoryPath, before);
    if (marked.length > 0) {
      await gitOk(repositoryPath, ["reset", "--hard", before]);
      return { status: "conflict", files: marked };
    }

    const sha = (await gitOk(repositoryPath, ["rev-parse", "HEAD"])).trim();
    return { status: "merged", sha };
  } finally {
    if (await hasMergeHead(repositoryPath)) {
      await gitOk(repositoryPath, ["merge", "--abort"]);
    }
  }
}

export async function commitResolution(
  repositoryPath: string,
  files: readonly { path: string; text: string }[],
): Promise<void> {
  if (files.length === 0 || files.some((file) => hasConflictMarkers(file.text))) {
    throw new Error("The conflict is still unresolved.");
  }
  await commitReviewedEdits(
    repositoryPath,
    files.map((file) => ({ path: file.path, text: file.text })),
    "Resolve merge conflict",
  );
}

async function filesWithMarkers(repositoryPath: string, before: string): Promise<MergeConflictFile[]> {
  const names = splitPaths(await gitOk(repositoryPath, ["diff", "--name-only", before, "HEAD"]));
  const files: MergeConflictFile[] = [];
  for (const path of names) {
    const modified = await gitOk(repositoryPath, ["show", `HEAD:${path}`]);
    if (!hasConflictMarkers(modified)) {
      continue;
    }
    files.push({ path, original: await showOrEmpty(repositoryPath, `${before}:${path}`), modified });
  }
  return files;
}

async function filesFromWorktree(
  repositoryPath: string,
  before: string,
  paths: readonly string[],
): Promise<MergeConflictFile[]> {
  const files: MergeConflictFile[] = [];
  for (const path of paths) {
    const modified = await readFile(resolve(repositoryPath, ...path.split("/")), "utf8");
    files.push({ path, original: await showOrEmpty(repositoryPath, `${before}:${path}`), modified });
  }
  return files;
}

async function unmergedPaths(repositoryPath: string): Promise<string[]> {
  return splitPaths(await gitOk(repositoryPath, ["diff", "--name-only", "--diff-filter=U"]));
}

async function showOrEmpty(repositoryPath: string, spec: string): Promise<string> {
  const result = await gitResult(repositoryPath, ["show", spec]);
  return result.code === 0 ? result.stdout : "";
}

async function hasMergeHead(repositoryPath: string): Promise<boolean> {
  const result = await gitResult(repositoryPath, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

function splitPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter((line) => line.length > 0);
}

function gitOk(cwd: string, args: string[]): Promise<string> {
  return gitResult(cwd, args).then((result) => {
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
    }
    return result.stdout;
  });
}

function gitResult(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", ["--no-pager", "-c", "core.quotepath=false", ...args], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_MERGE_AUTOEDIT: "no" },
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
      resolveOutput({ code: code ?? 1, stdout, stderr });
    });
  });
}
