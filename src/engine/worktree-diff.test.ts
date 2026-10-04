import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { collectWorktreeDiff, commitReviewedEdits } from "./worktree-diff";

const gitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Swarmy Test",
  GIT_AUTHOR_EMAIL: "swarmy@example.com",
  GIT_COMMITTER_NAME: "Swarmy Test",
  GIT_COMMITTER_EMAIL: "swarmy@example.com",
};

it("names the changed file in a worktree diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarmy-diff-"));
  try {
    const repo = join(root, "repo");
    const worktree = join(root, "wt");
    await mkdir(repo);
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.email", "swarmy@example.com"]);
    await git(repo, ["config", "user.name", "Swarmy Test"]);
    await git(repo, ["config", "core.autocrlf", "false"]);
    await writeFile(join(repo, "README.md"), "hello\n");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "init"]);
    await git(repo, ["worktree", "add", "-b", "swarm/review", worktree]);
    await writeFile(join(worktree, "README.md"), "hello world\n");

    const diff = await collectWorktreeDiff(worktree);

    expect(diff.files.map((file) => file.path)).toContain("README.md");
    expect(diff.patch).toContain("README.md");
    const readme = diff.files.find((file) => file.path === "README.md");
    expect(readme?.original).toBe("hello\n");
    expect(readme?.modified).toBe("hello world\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("leaves the agent store out of the review and the approve commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarmy-diff-"));
  try {
    const repo = join(root, "repo");
    const worktree = join(root, "wt");
    await mkdir(repo);
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.email", "swarmy@example.com"]);
    await git(repo, ["config", "user.name", "Swarmy Test"]);
    await git(repo, ["config", "core.autocrlf", "false"]);
    await writeFile(join(repo, "README.md"), "hello\n");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "init"]);
    await git(repo, ["worktree", "add", "-b", "swarm/review", worktree]);
    await writeFile(join(worktree, "README.md"), "hello world\n");
    await mkdir(join(worktree, "agent-store"));
    await writeFile(join(worktree, "agent-store", "runs.ndjson"), "{\"run\":1}\n");

    const diff = await collectWorktreeDiff(worktree);
    expect(diff.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(diff.patch).not.toContain("agent-store");

    await commitReviewedEdits(worktree, [{ path: "README.md", text: "reviewed\n" }]);
    const tracked = await git(worktree, ["ls-files"]);
    expect(tracked).toContain("README.md");
    expect(tracked).not.toContain("agent-store");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
