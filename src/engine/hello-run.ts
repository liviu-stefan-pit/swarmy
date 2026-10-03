import type { HelloResult } from "./runtime";

export const SYSTEM_PROMPT_WARNING =
  "systemPrompt is not available on this account. The instructions were prefixed to the prompt.";

export interface HelloRun {
  readonly id: string;
  stream(): AsyncIterable<unknown>;
  wait(): Promise<{
    status: "finished" | "error" | "cancelled";
    result?: string;
    error?: { message?: string };
    id?: string;
  }>;
}

export interface HelloAgent {
  readonly agentId: string;
  send(prompt: string): Promise<HelloRun>;
  dispose(): Promise<void>;
}

export async function runHello(input: {
  prompt: string;
  systemPrompt: string;
  createAgent: (systemPrompt: string | undefined) => Promise<HelloAgent>;
  log?: (agentId: string, runId: string) => void;
}): Promise<HelloResult> {
  const first = await attempt(input, input.systemPrompt, input.prompt);
  if (first.ok) {
    return { text: first.text, systemPromptAccepted: true };
  }
  if (!first.systemPromptRejected) {
    throw first.error;
  }

  const second = await attempt(input, undefined, `${input.systemPrompt}\n\n${input.prompt}`);
  if (!second.ok) {
    throw second.error;
  }
  return {
    text: second.text,
    systemPromptAccepted: false,
    warning: SYSTEM_PROMPT_WARNING,
  };
}

async function attempt(
  input: {
    createAgent: (systemPrompt: string | undefined) => Promise<HelloAgent>;
    log?: (agentId: string, runId: string) => void;
  },
  systemPrompt: string | undefined,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; systemPromptRejected: boolean; error: unknown }> {
  const agent = await input.createAgent(systemPrompt);
  try {
    const run = await agent.send(prompt);
    input.log?.(agent.agentId, run.id);
    const text = await finishRun(run);
    return { ok: true, text };
  } catch (error) {
    return {
      ok: false,
      systemPromptRejected: isSystemPromptRejection(error),
      error,
    };
  } finally {
    await agent.dispose();
  }
}

async function finishRun(run: HelloRun): Promise<string> {
  let streamed = "";
  for await (const event of run.stream()) {
    streamed += assistantText(event);
  }

  const result = await run.wait();
  if (result.status === "error") {
    throw new Error(`Hello run failed: ${result.error?.message ?? result.id ?? "unknown"}`);
  }
  if (result.status === "cancelled") {
    throw new Error("Hello run was cancelled");
  }
  if (result.result && result.result.length > 0) {
    return result.result;
  }
  return streamed;
}

function isSystemPromptRejection(error: unknown): boolean {
  return error instanceof Error && error.message.includes("--system-prompt");
}

function assistantText(event: unknown): string {
  if (!isRecord(event) || event.type !== "assistant") {
    return "";
  }
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return "";
  }
  let text = "";
  for (const block of message.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
