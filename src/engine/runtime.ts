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

export interface AgentRuntime {
  account(apiKey: string): Promise<RuntimeAccount>;
  models(apiKey: string): Promise<RuntimeModel[]>;
  hello(request: HelloRequest): Promise<HelloResult>;
}

export const HELLO_PROMPT =
  "Reply with one short sentence. Do not create, edit, or delete any files.";

export const HELLO_SYSTEM_PROMPT =
  "You are a connection probe. Answer in one short sentence. Do not change any files.";
