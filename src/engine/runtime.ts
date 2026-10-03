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
  | { type: "tool"; name: string; status: "running" | "completed" | "error" }
  | { type: "warning"; text: string };

export type RuntimeRunStatus = "finished" | "error" | "cancelled";

export interface RuntimeRunResult {
  status: RuntimeRunStatus;
  text: string;
  error?: string;
}

export type SteerAck = "complete_delivered" | "revert_to_followup";

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
  dispose(): Promise<void>;
}

export interface CreateAgentRequest {
  apiKey: string;
  cwd: string;
  modelId?: string;
  systemPrompt?: string;
  tools?: string[];
  disallowedTools?: string[];
}

export interface AgentRuntime {
  account(apiKey: string): Promise<RuntimeAccount>;
  models(apiKey: string): Promise<RuntimeModel[]>;
  hello(request: HelloRequest): Promise<HelloResult>;
  create(request: CreateAgentRequest): Promise<RuntimeAgent>;
}

export const HELLO_PROMPT =
  "Reply with one short sentence. Do not create, edit, or delete any files.";

export const HELLO_SYSTEM_PROMPT =
  "You are a connection probe. Answer in one short sentence. Do not change any files.";
