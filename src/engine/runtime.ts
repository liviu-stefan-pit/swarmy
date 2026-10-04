export interface RuntimeModel {
  id: string;
}

export interface RuntimeAccount {
  label: string;
}

export interface HelloRequest {
  apiKey: string;
  cwd: string;
  prompt: string;
  systemPrompt: string;
}

export interface HelloResult {
  text: string;
  systemPromptAccepted: boolean;
  warning?: string;
}

export type RuntimeEvent =
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; status: "running" | "completed" | "error"; detail?: string }
  | { type: "warning"; text: string };

export type RuntimeRunStatus = "finished" | "error" | "cancelled";

export interface RuntimeTokenUsage {
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Dollar cost from `agent.getUsage()`. Omit `chargedCents` when the SDK has not reported a cost. */
export interface RuntimeCost {
  chargedCents?: number;
}

export interface RuntimeRunResult {
  status: RuntimeRunStatus;
  text: string;
  error?: string;
  usage?: RuntimeTokenUsage;
}

export type SteerAck = "complete_delivered" | "revert_to_followup";

export interface RuntimeMcpServer {
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export interface RuntimeRun {
  readonly id: string;
  stream(): AsyncIterable<RuntimeEvent>;
  wait(): Promise<RuntimeRunResult>;
  cancel(): Promise<void>;
  steer(text: string): Promise<SteerAck>;
}

export interface RuntimeAgent {
  readonly agentId: string;
  send(prompt: string): Promise<RuntimeRun>;
  getUsage(): Promise<RuntimeCost>;
  dispose(): Promise<void>;
}

export type RuntimeJson =
  | string
  | number
  | boolean
  | null
  | RuntimeJson[]
  | { [key: string]: RuntimeJson };

export interface RuntimeCustomTool {
  description?: string;
  inputSchema?: { [key: string]: RuntimeJson };
  execute(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface CreateAgentRequest {
  apiKey: string;
  cwd: string;
  modelId?: string;
  systemPrompt?: string;
  tools?: string[];
  disallowedTools?: string[];
  customTools?: Record<string, RuntimeCustomTool>;
  mcpServers?: Record<string, RuntimeMcpServer>;
  guardrails?: boolean;
  writePaths?: string[];
  sandboxEnabled?: boolean;
  autoReview?: boolean;
}

export interface ResumeAgentRequest extends CreateAgentRequest {
  agentId: string;
}

export interface AgentRuntime {
  account(apiKey: string): Promise<RuntimeAccount>;
  models(apiKey: string): Promise<RuntimeModel[]>;
  hello(request: HelloRequest): Promise<HelloResult>;
  create(request: CreateAgentRequest): Promise<RuntimeAgent>;
  resume(request: ResumeAgentRequest): Promise<RuntimeAgent>;
  usageForAgent(apiKey: string, agentId: string): Promise<RuntimeCost>;
}

export const HELLO_PROMPT =
  "Reply with one short sentence. Do not create, edit, or delete any files.";

export const HELLO_SYSTEM_PROMPT =
  "You are a connection probe. Answer in one short sentence. Do not change any files.";
