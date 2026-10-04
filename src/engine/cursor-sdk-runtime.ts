import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  Agent,
  Cursor,
  CursorSdkError,
  JsonlLocalAgentStore,
  type Run,
  type RunResult,
  type McpServerConfig,
  type SDKAgent,
  type SDKCustomTool,
  type SDKMessage,
  type SDKUser,
  type SteerAckOutcome,
} from "@cursor/sdk";
import { SYSTEM_PROMPT_WARNING, runHello } from "./hello-run";
import type {
  AgentRuntime,
  CreateAgentRequest,
  HelloRequest,
  HelloResult,
  ResumeAgentRequest,
  RuntimeAccount,
  RuntimeAgent,
  RuntimeCustomTool,
  RuntimeEvent,
  RuntimeMcpServer,
  RuntimeModel,
  RuntimeRun,
  RuntimeRunResult,
  SteerAck,
} from "./runtime";

export class CursorSdkRuntime implements AgentRuntime {
  account(apiKey: string): Promise<RuntimeAccount> {
    return this.guard(apiKey, async () => {
      const user = await Cursor.me({ apiKey });
      return { label: accountLabel(user) };
    });
  }

  models(apiKey: string): Promise<RuntimeModel[]> {
    return this.guard(apiKey, async () => {
      const listed = await Cursor.models.list({ apiKey });
      return listed.map((model) => ({ id: model.id }));
    });
  }

  hello(request: HelloRequest): Promise<HelloResult> {
    return this.guard(request.apiKey, async () => {
      const modelId = await pickModel(request.apiKey);
      return runHello({
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        log(agentId, runId) {
          console.log(`cursor agent ${agentId} run ${runId}`);
        },
        async createAgent(systemPrompt) {
          const agent = await createAgent(request, modelId, systemPrompt);
          return {
            agentId: agent.agentId,
            send: (prompt) => agent.send(prompt),
            dispose: () => disposeQuietly(agent),
          };
        },
      });
    });
  }

  create(request: CreateAgentRequest): Promise<RuntimeAgent> {
    return this.guard(request.apiKey, async () => {
      const modelId = request.modelId?.trim() || (await pickModel(request.apiKey));
      const session = new SdkSession(request, modelId);
      const systemPrompt = request.systemPrompt?.trim();
      await session.open(systemPrompt ? systemPrompt : undefined);
      return session;
    });
  }

  resume(request: ResumeAgentRequest): Promise<RuntimeAgent> {
    return this.guard(request.apiKey, async () => {
      const modelId = request.modelId?.trim() || (await pickModel(request.apiKey));
      const session = new SdkSession(request, modelId);
      const systemPrompt = request.systemPrompt?.trim();
      await session.openResume(request.agentId, systemPrompt ? systemPrompt : undefined);
      return session;
    });
  }

  private async guard<T>(apiKey: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof CursorSdkError) {
        throw new Error(`Cursor connection failed: ${publicMessage(error, apiKey)}`, { cause: error });
      }
      if (error instanceof Error) {
        throw new Error(publicMessage(error, apiKey), { cause: error });
      }
      throw new Error("The request failed", { cause: error });
    }
  }
}

async function pickModel(apiKey: string): Promise<string> {
  const models = await Cursor.models.list({ apiKey });
  const preferred = models.find((model) => model.id === "composer-2.5") ?? models[0];
  if (!preferred) {
    throw new Error("No models are available for this API key");
  }
  return preferred.id;
}

function createAgent(request: HelloRequest, modelId: string, systemPrompt: string | undefined): Promise<SDKAgent> {
  const storeDir = join(request.cwd, "agent-store");
  mkdirSync(storeDir, { recursive: true });
  return Agent.create({
    apiKey: request.apiKey,
    name: "Swarmy hello",
    model: { id: modelId },
    local: {
      cwd: request.cwd,
      store: new JsonlLocalAgentStore(storeDir),
    },
    tools: [],
    ...(systemPrompt ? { systemPrompt } : {}),
  });
}

function accountLabel(user: SDKUser): string {
  const name = [user.userFirstName, user.userLastName].filter((part) => part && part.trim().length > 0).join(" ");
  if (user.userEmail && name) {
    return `${name} (${user.userEmail})`;
  }
  if (user.userEmail) {
    return user.userEmail;
  }
  if (name) {
    return name;
  }
  if (user.apiKeyName.trim().length > 0) {
    return user.apiKeyName;
  }
  return "Cursor account";
}

function publicMessage(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : "The request failed";
  if (!apiKey) {
    return message;
  }
  return message.split(apiKey).join("[redacted]");
}

async function disposeQuietly(agent: SDKAgent): Promise<void> {
  try {
    await agent[Symbol.asyncDispose]();
  } catch {
    // Disposal is best-effort after a failed create or send.
  }
}

class SdkSession implements RuntimeAgent {
  agentId = "";
  private current: SDKAgent | undefined;
  private didRetry = false;

  constructor(
    private readonly request: CreateAgentRequest,
    private readonly modelId: string,
  ) {}

  get canRetry(): boolean {
    return !this.didRetry && Boolean(this.request.systemPrompt?.trim());
  }

  async open(systemPrompt: string | undefined): Promise<void> {
    this.current = await createLocalAgent(this.request, this.modelId, systemPrompt);
    this.agentId = this.current.agentId;
  }

  async openResume(agentId: string, systemPrompt: string | undefined): Promise<void> {
    this.current = await resumeLocalAgent({ ...this.request, agentId }, this.modelId, systemPrompt);
    this.agentId = this.current.agentId;
  }

  async send(prompt: string): Promise<RuntimeRun> {
    const agent = this.requireAgent();
    try {
      const run = await agent.send(prompt);
      console.log(`cursor agent ${agent.agentId} run ${run.id}`);
      return new LocalRun(this, run, prompt, false);
    } catch (error) {
      if (isSystemPromptRejection(error) && this.canRetry) {
        const run = await this.retry(prompt);
        return new LocalRun(this, run, prompt, true);
      }
      throw redact(error, this.request.apiKey);
    }
  }

  async retry(prompt: string): Promise<Run> {
    const systemPrompt = this.request.systemPrompt?.trim();
    if (!systemPrompt || this.didRetry) {
      throw new Error("systemPrompt is not available on this account");
    }
    this.didRetry = true;
    const previous = this.current;
    this.current = undefined;
    if (previous) {
      await disposeQuietly(previous);
    }
    await this.open(undefined);
    const agent = this.requireAgent();
    const run = await agent.send(`${systemPrompt}\n\n${prompt}`);
    console.log(`cursor agent ${agent.agentId} run ${run.id}`);
    return run;
  }

  async dispose(): Promise<void> {
    const current = this.current;
    this.current = undefined;
    if (current) {
      await disposeQuietly(current);
    }
  }

  private requireAgent(): SDKAgent {
    if (!this.current) {
      throw new Error("Agent is not open");
    }
    return this.current;
  }
}

class LocalRun implements RuntimeRun {
  private settled: RuntimeRunResult | undefined;
  private active: Run;

  constructor(
    private readonly session: SdkSession,
    active: Run,
    private readonly prompt: string,
    private announceFallback: boolean,
  ) {
    this.active = active;
  }

  get id(): string {
    return this.active.id;
  }

  async *stream(): AsyncIterable<RuntimeEvent> {
    if (this.settled) {
      return;
    }
    if (this.announceFallback) {
      this.announceFallback = false;
      yield { type: "warning", text: SYSTEM_PROMPT_WARNING };
    }
    yield* mapStream(this.active);
    let result = await this.active.wait();
    if (isSystemPromptResult(result) && this.session.canRetry) {
      yield { type: "warning", text: SYSTEM_PROMPT_WARNING };
      this.active = await this.session.retry(this.prompt);
      yield* mapStream(this.active);
      result = await this.active.wait();
    }
    this.settled = toRuntimeResult(result);
  }

  async wait(): Promise<RuntimeRunResult> {
    if (!this.settled) {
      for await (const event of this.stream()) {
        void event;
      }
    }
    if (!this.settled) {
      throw new Error("Run produced no result");
    }
    return this.settled;
  }

  async cancel(): Promise<void> {
    if (this.active.supports("cancel")) {
      await this.active.cancel();
    }
  }

  async steer(text: string): Promise<SteerAck> {
    if (!this.active.steer) {
      return "revert_to_followup";
    }
    const outcome: SteerAckOutcome = await this.active.steer(text);
    return outcome;
  }
}

function createLocalAgent(
  request: CreateAgentRequest,
  modelId: string,
  systemPrompt: string | undefined,
): Promise<SDKAgent> {
  const storeDir = join(request.cwd, "agent-store");
  mkdirSync(storeDir, { recursive: true });
  return Agent.create({
    apiKey: request.apiKey,
    name: "Swarmy agent",
    model: { id: modelId },
    local: {
      cwd: request.cwd,
      settingSources: [],
      store: new JsonlLocalAgentStore(storeDir),
      ...(request.customTools ? { customTools: toSdkCustomTools(request.customTools) } : {}),
    },
    ...(request.tools !== undefined ? { tools: withHandoffTool(request.tools, request.customTools) } : {}),
    ...(request.disallowedTools !== undefined ? { disallowedTools: request.disallowedTools } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    mcpServers: toSdkMcpServers(request.mcpServers),
  });
}

function resumeLocalAgent(
  request: ResumeAgentRequest,
  modelId: string,
  systemPrompt: string | undefined,
): Promise<SDKAgent> {
  const storeDir = join(request.cwd, "agent-store");
  mkdirSync(storeDir, { recursive: true });
  return Agent.resume(request.agentId, {
    apiKey: request.apiKey,
    name: "Swarmy agent",
    model: { id: modelId },
    local: {
      cwd: request.cwd,
      settingSources: [],
      store: new JsonlLocalAgentStore(storeDir),
      ...(request.customTools ? { customTools: toSdkCustomTools(request.customTools) } : {}),
    },
    ...(request.tools !== undefined ? { tools: withHandoffTool(request.tools, request.customTools) } : {}),
    ...(request.disallowedTools !== undefined ? { disallowedTools: request.disallowedTools } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    mcpServers: toSdkMcpServers(request.mcpServers),
  });
}

async function* mapStream(run: Run): AsyncIterable<RuntimeEvent> {
  for await (const message of run.stream()) {
    const event = mapSdkMessage(message);
    if (event) {
      yield event;
    }
  }
}

function mapSdkMessage(message: SDKMessage): RuntimeEvent | undefined {
  switch (message.type) {
    case "assistant": {
      let text = "";
      for (const block of message.message.content) {
        if (block.type === "text") {
          text += block.text;
        }
      }
      return text.length > 0 ? { type: "assistant", text } : undefined;
    }
    case "tool_call":
      return { type: "tool", name: message.name, status: message.status };
    case "thinking":
      return message.text.length > 0 ? { type: "assistant", text: message.text } : undefined;
    default:
      return undefined;
  }
}

function toRuntimeResult(result: RunResult): RuntimeRunResult {
  if (result.status === "error") {
    return {
      status: "error",
      text: result.result ?? "",
      error: result.error?.message ?? "Run failed",
    };
  }
  if (result.status === "cancelled") {
    return { status: "cancelled", text: result.result ?? "" };
  }
  return { status: "finished", text: result.result ?? "" };
}

function isSystemPromptResult(result: RunResult): boolean {
  return result.status === "error" && isSystemPromptMessage(result.error?.message);
}

function isSystemPromptRejection(error: unknown): boolean {
  return error instanceof Error && isSystemPromptMessage(error.message);
}

function isSystemPromptMessage(message: string | undefined): boolean {
  return Boolean(message?.includes("--system-prompt"));
}

function toSdkMcpServers(
  servers: Record<string, RuntimeMcpServer> | undefined,
): Record<string, McpServerConfig> {
  const mapped: Record<string, McpServerConfig> = {};
  if (!servers) {
    return mapped;
  }
  for (const [name, server] of Object.entries(servers)) {
    if (server.command) {
      mapped[name] = {
        command: server.command,
        ...(server.args ? { args: server.args } : {}),
      };
      continue;
    }
    if (server.url) {
      mapped[name] = {
        url: server.url,
        ...(server.headers ? { headers: server.headers } : {}),
      };
    }
  }
  return mapped;
}

function withHandoffTool(
  tools: string[],
  customTools: Record<string, RuntimeCustomTool> | undefined,
): string[] {
  if (!customTools || Object.keys(customTools).length === 0 || tools.includes("mcp")) {
    return tools;
  }
  return [...tools, "mcp"];
}

function toSdkCustomTools(tools: Record<string, RuntimeCustomTool>): Record<string, SDKCustomTool> {
  const mapped: Record<string, SDKCustomTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    mapped[name] = {
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
      execute: async (args) => {
        const value = await tool.execute(args);
        return typeof value === "string" ? value : "ok";
      },
    };
  }
  return mapped;
}

function redact(error: unknown, apiKey: string): Error {
  const message = publicMessage(error, apiKey);
  return new Error(message.length > 0 ? message : "The request failed", { cause: error });
}
