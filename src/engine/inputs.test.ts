import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { Workflow } from "@shared/workflow";
import { FakeRuntime, type FakeRuntimeScript } from "./fake-runtime";
import { runWorkflow, resumeWorkflow } from "./orchestrator";
import { SqliteCheckpointer } from "./sqlite-checkpointer";
import { openSqliteDatabase } from "./sqlite-spike";
import { createWorkspaceManager, type WorkspaceManager } from "./workspace-manager";

const excerptLimit = 20 * 1024;
const sentinel = "SENTINEL-PAST-EXCERPT";

const baseScript = {
  accountLabel: "fake@swarmy.local",
  models: [{ id: "fake-model" }],
  helloText: "Hello from the fake runtime.",
  defaultPrompt: { chunks: ["done"], result: "done" },
} satisfies FakeRuntimeScript;

function blockNetwork(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("FakeRuntime must not call the network");
  });
}

async function withWorkspaces(run: (workspaces: WorkspaceManager) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "swarmy-inputs-"));
  const workspaces = createWorkspaceManager({ rootDir: root });
  try {
    await run(workspaces);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("a 1 MB dropped file contributes at most 20 KB of excerpt to the downstream prompt, and the prompt contains the file path", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-drop-"));
  const sourcePath = join(dir, "dropped-notes.txt");
  const bytes = Buffer.alloc(1024 * 1024, 0x62);
  bytes.fill(0x61, 0, excerptLimit);
  Buffer.from("HEAD-MARK").copy(bytes, 0);
  Buffer.from(sentinel).copy(bytes, excerptLimit);
  await writeFile(sourcePath, bytes);

  const workflow: Workflow = {
    id: "file-drop",
    name: "File drop",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "notes",
        type: "fileInput",
        position: { x: 0, y: 0 },
        data: { label: "Notes", sourcePath },
      },
      {
        id: "reader",
        type: "agent",
        position: { x: 240, y: 0 },
        data: { label: "Reader", taskPrompt: "read-the-file" },
      },
    ],
    edges: [
      {
        id: "notes-reader",
        source: "notes",
        sourceHandle: "file",
        target: "reader",
        targetHandle: "file",
      },
    ],
  };

  try {
    const runtime = new FakeRuntime(baseScript);
    await withWorkspaces(async (workspaces) => {
      await runWorkflow({
        workflow,
        runtime,
        apiKey: "fake-key",
        workspaces,
      });
    });

    const prompt = runtime.sentPrompts.find((item) => item.includes("read-the-file"));
    expect(prompt).toBeDefined();
    expect(prompt).toMatch(/[/\\]dropped-notes\.txt/);
    expect(prompt).toContain("HEAD-MARK");
    expect(prompt).not.toContain(sentinel);
    expect(prompt?.length ?? 0).toBeLessThan(excerptLimit + 8 * 1024);
  } finally {
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it("puts text from a text node into the downstream prompt", async () => {
  const fetchSpy = blockNetwork();
  const workflow: Workflow = {
    id: "brief",
    name: "Brief",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "brief",
        type: "textInput",
        position: { x: 0, y: 0 },
        data: { label: "Brief", text: "Ship the bounded excerpt." },
      },
      {
        id: "writer",
        type: "agent",
        position: { x: 240, y: 0 },
        data: { label: "Writer", taskPrompt: "write-from-brief" },
      },
    ],
    edges: [
      {
        id: "brief-writer",
        source: "brief",
        sourceHandle: "text",
        target: "writer",
        targetHandle: "text",
      },
    ],
  };

  try {
    const runtime = new FakeRuntime(baseScript);
    await withWorkspaces(async (workspaces) => {
      await runWorkflow({ workflow, runtime, apiKey: "fake-key", workspaces });
    });
    const prompt = runtime.sentPrompts.find((item) => item.includes("write-from-brief"));
    expect(prompt).toContain("Ship the bounded excerpt.");
  } finally {
    fetchSpy.mockRestore();
  }
});

it("sets the agent workspace to folder mode from a connected folder node", async () => {
  const fetchSpy = blockNetwork();
  const folderPath = await mkdtemp(join(tmpdir(), "swarmy-folder-"));
  const workflow: Workflow = {
    id: "folder",
    name: "Folder",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "workspace",
        type: "folderInput",
        position: { x: 0, y: 0 },
        data: { label: "Workspace", folderPath },
      },
      {
        id: "worker",
        type: "agent",
        position: { x: 240, y: 0 },
        data: { label: "Worker", taskPrompt: "work-in-folder", workspaceMode: "managed" },
      },
    ],
    edges: [
      {
        id: "folder-worker",
        source: "workspace",
        sourceHandle: "folder",
        target: "worker",
        targetHandle: "folder",
      },
    ],
  };

  try {
    const runtime = new FakeRuntime(baseScript);
    await withWorkspaces(async (workspaces) => {
      await runWorkflow({ workflow, runtime, apiKey: "fake-key", workspaces });
    });
    expect(runtime.created[0]?.cwd).toBe(resolve(folderPath));
  } finally {
    fetchSpy.mockRestore();
    await rm(folderPath, { recursive: true, force: true });
  }
});

it("adds a connected MCP server on create and again on resume", async () => {
  const fetchSpy = blockNetwork();
  const dir = await mkdtemp(join(tmpdir(), "swarmy-mcp-resume-"));
  const dbPath = join(dir, "swarmy.db");
  const checkpointer = SqliteCheckpointer.open(dbPath);
  const workflow: Workflow = {
    id: "mcp-run",
    name: "MCP run",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "source",
        type: "agent",
        position: { x: 0, y: 0 },
        data: { label: "Source", taskPrompt: "source-task" },
      },
      {
        id: "tools",
        type: "mcp",
        position: { x: 0, y: 160 },
        data: { label: "Tools", transport: "stdio", command: "echo-mcp", args: ["--stdio"] },
      },
      {
        id: "worker",
        type: "agent",
        position: { x: 280, y: 0 },
        data: { label: "Worker", taskPrompt: "worker-task", systemPrompt: "worker-system" },
      },
    ],
    edges: [
      {
        id: "source-worker",
        source: "source",
        sourceHandle: "text",
        target: "worker",
        targetHandle: "text",
      },
      {
        id: "tools-worker",
        source: "tools",
        sourceHandle: "mcp",
        target: "worker",
        targetHandle: "mcp",
      },
    ],
  };
  const expectedServers = {
    Tools: { command: "echo-mcp", args: ["--stdio"] },
  };

  try {
    await withWorkspaces(async (workspaces) => {
      const runtime = new FakeRuntime({
        ...baseScript,
        prompts: { "source-task": { chunks: ["source"], result: "source done" } },
      });
      const threadId = "mcp-thread";
      await runWorkflow({
        workflow,
        runtime,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
        interruptAfter: ["source"],
      });
      expect(runtime.created.some((request) => request.mcpServers && "Tools" in request.mcpServers)).toBe(false);

      const db = openSqliteDatabase(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS run_agents (
          thread_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          PRIMARY KEY (thread_id, node_id)
        )
      `);
      db.prepare("INSERT OR REPLACE INTO run_agents (thread_id, node_id, agent_id) VALUES (?, ?, ?)").run(
        threadId,
        "worker",
        "agent-worker",
      );
      db.close();

      const resumed = new FakeRuntime(baseScript);
      await resumeWorkflow({
        workflow,
        runtime: resumed,
        apiKey: "fake-key",
        workspaces,
        checkpointer,
        threadId,
      });
      expect(resumed.resumes).toContainEqual(
        expect.objectContaining({
          agentId: "agent-worker",
          mcpServers: expectedServers,
        }),
      );
      expect(resumed.created.some((request) => request.mcpServers?.Tools)).toBeFalsy();
    });
  } finally {
    checkpointer.close();
    fetchSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

it("passes resolved MCP headers into the agent and keeps them out of the workflow JSON", async () => {
  const fetchSpy = blockNetwork();
  const headerValue = "super-secret-mcp-header";
  const workflow: Workflow = {
    id: "mcp-http",
    name: "MCP http",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "tools",
        type: "mcp",
        position: { x: 0, y: 0 },
        data: {
          label: "Tools",
          transport: "http",
          url: "http://127.0.0.1:9/mcp",
          headerSecretId: "secret-1",
        },
      },
      {
        id: "worker",
        type: "agent",
        position: { x: 240, y: 0 },
        data: { label: "Worker", taskPrompt: "use-tools" },
      },
    ],
    edges: [
      {
        id: "tools-worker",
        source: "tools",
        sourceHandle: "mcp",
        target: "worker",
        targetHandle: "mcp",
      },
    ],
  };

  try {
    const runtime = new FakeRuntime(baseScript);
    await withWorkspaces(async (workspaces) => {
      await runWorkflow({
        workflow,
        runtime,
        apiKey: "fake-key",
        workspaces,
        mcpHeaders: { "secret-1": { Authorization: headerValue } },
      });
    });
    expect(runtime.created[0]?.mcpServers).toEqual({
      Tools: { url: "http://127.0.0.1:9/mcp", headers: { Authorization: headerValue } },
    });
    expect(JSON.stringify(workflow)).not.toContain(headerValue);
  } finally {
    fetchSpy.mockRestore();
  }
});
