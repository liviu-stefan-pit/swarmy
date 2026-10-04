import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";

const rpcMessageSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

const toolsResultSchema = z.object({
  tools: z.array(z.object({ name: z.string().min(1) }).passthrough()),
});

export interface McpListRequest {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export async function listMcpTools(request: McpListRequest): Promise<string[]> {
  if (request.transport === "http") {
    if (!request.url) {
      throw new Error("MCP HTTP needs a url");
    }
    return listHttpTools(request.url, request.headers ?? {});
  }
  if (!request.command) {
    throw new Error("MCP stdio needs a command");
  }
  return listStdioTools(request.command, request.args ?? []);
}

async function listStdioTools(command: string, args: readonly string[]): Promise<string[]> {
  const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const reader = new StdioReader(child);
  try {
    return await withTimeout(exchange(child, reader), 15_000, () => {
      child.kill();
    });
  } finally {
    child.kill();
    reader.stop();
  }
}

async function exchange(child: ChildProcessWithoutNullStreams, reader: StdioReader): Promise<string[]> {
  await reader.send(child, "initialize", 1, {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "Swarmy", version: "0.1.0" },
  });
  reader.write(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await reader.send(child, "tools/list", 2, {});
  return toolNames(listed);
}

async function listHttpTools(url: string, headers: Record<string, string>): Promise<string[]> {
  const initialize = await postJson(
    url,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "Swarmy", version: "0.1.0" },
      },
    },
    headers,
  );
  const session = initialize.session;
  await postJson(
    url,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    headers,
    session,
  );
  const listed = await postJson(
    url,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    headers,
    session,
  );
  return toolNames(listed.message);
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  session?: string,
): Promise<{ message: unknown; session?: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify(body),
  });
  const nextSession = response.headers.get("mcp-session-id") ?? session;
  const text = await response.text();
  if (!response.ok && text.trim().length === 0) {
    throw new Error("The MCP server did not list tools.");
  }
  return { message: parseHttpBody(text), ...(nextSession ? { session: nextSession } : {}) };
}

function parseHttpBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as unknown;
  }
  const data = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
  const last = data[data.length - 1];
  if (!last) return undefined;
  return JSON.parse(last) as unknown;
}

function toolNames(message: unknown): string[] {
  const rpc = rpcMessageSchema.safeParse(message);
  if (!rpc.success || rpc.data.error !== undefined) {
    throw new Error("The MCP server did not list tools.");
  }
  const tools = toolsResultSchema.safeParse(rpc.data.result);
  if (!tools.success) {
    throw new Error("The MCP server did not list tools.");
  }
  return tools.data.tools.map((tool) => tool.name);
}

class StdioReader {
  private buffer = "";
  private readonly pending = new Map<number, (message: unknown) => void>();
  private failed: Error | undefined;

  constructor(child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    child.on("error", (error) => {
      this.fail(error instanceof Error ? error : new Error("The MCP server did not start."));
    });
    child.on("exit", () => {
      if (this.pending.size > 0) {
        this.fail(new Error("The MCP server stopped before listing tools."));
      }
    });
  }

  write(child: ChildProcessWithoutNullStreams, message: unknown): void {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  send(
    child: ChildProcessWithoutNullStreams,
    method: string,
    id: number,
    params: unknown,
  ): Promise<unknown> {
    const pending = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, resolve);
      if (this.failed) {
        this.pending.delete(id);
        reject(this.failed);
      }
    });
    this.write(child, { jsonrpc: "2.0", id, method, params });
    return pending;
  }

  stop(): void {
    this.pending.clear();
  }

  private drain(): void {
    const taken = takeMessages(this.buffer);
    this.buffer = taken.rest;
    for (const message of taken.messages) {
      const rpc = rpcMessageSchema.safeParse(message);
      if (!rpc.success || typeof rpc.data.id !== "number") continue;
      const resolve = this.pending.get(rpc.data.id);
      if (!resolve) continue;
      this.pending.delete(rpc.data.id);
      resolve(message);
    }
  }

  private fail(error: Error): void {
    this.failed = error;
    for (const resolve of this.pending.values()) {
      resolve({ error: true });
    }
    this.pending.clear();
  }
}

function takeMessages(buffer: string): { messages: unknown[]; rest: string } {
  const messages: unknown[] = [];
  let rest = buffer;
  while (rest.length > 0) {
    if (rest.startsWith("Content-Length:")) {
      const headerEnd = rest.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const match = /Content-Length:\s*(\d+)/i.exec(rest.slice(0, headerEnd));
      const length = match?.[1] ? Number(match[1]) : Number.NaN;
      if (!Number.isFinite(length)) {
        throw new Error("The MCP server did not list tools.");
      }
      const start = headerEnd + 4;
      if (rest.length < start + length) break;
      messages.push(JSON.parse(rest.slice(start, start + length)) as unknown);
      rest = rest.slice(start + length);
      continue;
    }
    const newline = rest.indexOf("\n");
    if (newline < 0) break;
    const line = rest.slice(0, newline).trim();
    rest = rest.slice(newline + 1);
    if (line.length === 0) continue;
    messages.push(JSON.parse(line) as unknown);
  }
  return { messages, rest };
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error("The MCP server did not answer."));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("The MCP server did not list tools."));
      },
    );
  });
}
