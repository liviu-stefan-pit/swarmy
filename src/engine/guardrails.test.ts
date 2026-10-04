import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildAgentSdkOptions } from "./agent-sdk-options";
import { guardrailPromptNote, installGuardrails } from "./guardrails";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps disallowedTools on the SDK options", () => {
  const options = buildAgentSdkOptions({
    apiKey: "test-key",
    cwd: "C:\\work",
    modelId: "composer-2.5",
    disallowedTools: ["shell"],
  });

  expect(options.disallowedTools).toEqual(["shell"]);

  const guarded = buildAgentSdkOptions({
    apiKey: "test-key",
    cwd: "C:\\work",
    modelId: "composer-2.5",
    disallowedTools: ["shell"],
    guardrails: true,
    sandboxEnabled: true,
    autoReview: true,
  });

  expect(guarded.disallowedTools).toEqual(["shell"]);
  expect(guarded.local.settingSources).toEqual(["project"]);
  expect(guarded.local.sandboxOptions).toEqual({ enabled: true });
  expect(guarded.local.autoReview).toBe(true);
});

it(
  "denies git push --force and allows git status",
  async () => {
    const workspace = await tempWorkspace();
    await installGuardrails(workspace, { writePaths: ["src"] });

    const hooks = JSON.parse(await readFile(join(workspace, ".cursor", "hooks.json"), "utf8")) as {
      hooks: {
        preToolUse: Array<{ command: string; failClosed: boolean }>;
        beforeShellExecution: Array<{ command: string; failClosed: boolean }>;
      };
    };
    expect(hooks.hooks.preToolUse[0]?.failClosed).toBe(true);
    expect(hooks.hooks.preToolUse[0]?.command).toMatch(/powershell/i);
    expect(hooks.hooks.preToolUse[0]?.command).toMatch(/swarmy-guard\.ps1/);
    expect(hooks.hooks.beforeShellExecution[0]?.failClosed).toBe(true);

    const script = join(workspace, ".cursor", "hooks", "swarmy-guard.ps1");
    const forced = await runHook(script, {
      tool_name: "Shell",
      tool_input: { command: "git push --force" },
    });
    expect(forced.code).not.toBe(0);
    expect(forced.stdout).toMatch(/deny/i);

    const leased = await runHook(script, {
      command: "git push --force-with-lease",
    });
    expect(leased.code).not.toBe(0);
    expect(leased.stdout).toMatch(/deny/i);

    const removed = await runHook(script, {
      command: "Remove-Item -Recurse .",
    });
    expect(removed.code).not.toBe(0);
    expect(removed.stdout).toMatch(/deny/i);

    const status = await runHook(script, {
      tool_name: "Shell",
      tool_input: { command: "git status" },
    });
    expect(status.code).toBe(0);
    expect(status.stdout).toMatch(/allow/i);

    const broken = await runHook(script, "{");
    expect(broken.code).not.toBe(0);
    expect(broken.stdout).toMatch(/deny/i);
  },
  30_000,
);

it(
  "denies a write outside the scope and allows a write inside it",
  async () => {
    const workspace = await tempWorkspace();
    await installGuardrails(workspace, { writePaths: ["src"] });
    const script = join(workspace, ".cursor", "hooks", "swarmy-guard.ps1");

    expect(guardrailPromptNote(["src"])).toContain("src");

    const outside = await runHook(script, {
      tool_name: "Write",
      tool_input: { path: "../outside.txt" },
    });
    expect(outside.code).not.toBe(0);
    expect(outside.stdout).toMatch(/deny/i);

    const inside = await runHook(script, {
      tool_name: "Write",
      tool_input: { path: "src/ok.txt" },
    });
    expect(inside.code).toBe(0);
    expect(inside.stdout).toMatch(/allow/i);
  },
  30_000,
);

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-guard-"));
  roots.push(root);
  return root;
}

function runHook(
  scriptPath: string,
  payload: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    child.stdin.end(body);
  });
}
