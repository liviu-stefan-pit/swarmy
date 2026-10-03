import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Agent, Cursor, CursorSdkError, JsonlLocalAgentStore, type SDKAgent, type SDKUser } from "@cursor/sdk";
import { runHello } from "./hello-run";
import type { AgentRuntime, HelloRequest, HelloResult, RuntimeAccount, RuntimeModel } from "./runtime";

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
