export interface AgentSdkOptionInput {
  apiKey: string;
  cwd: string;
  modelId: string;
  systemPrompt?: string;
  tools?: string[];
  disallowedTools?: string[];
  guardrails?: boolean;
  sandboxEnabled?: boolean;
  autoReview?: boolean;
}

export interface AgentSdkOptions {
  apiKey: string;
  model: { id: string };
  local: {
    cwd: string;
    settingSources: Array<"project">;
    sandboxOptions?: { enabled: boolean };
    autoReview?: boolean;
  };
  tools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
}

export function buildAgentSdkOptions(input: AgentSdkOptionInput): AgentSdkOptions {
  return {
    apiKey: input.apiKey,
    model: { id: input.modelId },
    local: {
      cwd: input.cwd,
      settingSources: input.guardrails ? ["project"] : [],
      ...(input.sandboxEnabled !== undefined ? { sandboxOptions: { enabled: input.sandboxEnabled } } : {}),
      ...(input.autoReview !== undefined ? { autoReview: input.autoReview } : {}),
    },
    ...(input.tools !== undefined ? { tools: input.tools } : {}),
    ...(input.disallowedTools !== undefined ? { disallowedTools: input.disallowedTools } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
  };
}
