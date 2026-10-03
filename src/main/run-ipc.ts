import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  runCancelChannel,
  runCancelPayloadSchema,
  runStartChannel,
  runStartPayloadSchema,
  runUpdateSchema,
} from "@shared/runs";
import type { EngineHost } from "./engine-host";
import { readApiKey } from "./secret-store";

export function registerRunIpc(engine: EngineHost): void {
  ipcMain.handle(runStartChannel, async (_event, payload: unknown) => {
    const parsed = runStartPayloadSchema.parse(payload);
    const apiKey = apiKeyForRun();
    try {
      const result = await engine.request({
        type: "run.start",
        id: randomUUID(),
        nodeId: parsed.nodeId,
        apiKey,
        prompt: parsed.prompt,
        ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
        ...(parsed.systemPrompt !== undefined ? { systemPrompt: parsed.systemPrompt } : {}),
        ...(parsed.tools !== undefined ? { tools: parsed.tools } : {}),
        ...(parsed.disallowedTools !== undefined ? { disallowedTools: parsed.disallowedTools } : {}),
      });
      if (result.type !== "run.done") {
        throw new Error("Unexpected engine response");
      }
      return runUpdateSchema.parse({
        nodeId: result.nodeId,
        status: result.status,
        log: result.log,
      });
    } catch (error) {
      throw new Error(scrub(errorText(error), apiKey), { cause: error });
    }
  });

  ipcMain.handle(runCancelChannel, async (_event, payload: unknown) => {
    const parsed = runCancelPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "run.cancel",
      id: randomUUID(),
      nodeId: parsed.nodeId,
    });
    if (result.type !== "run.cancelResult") {
      throw new Error("Unexpected engine response");
    }
  });
}

function apiKeyForRun(): string {
  const saved = readApiKey();
  if (saved && saved.trim().length > 0) {
    return saved;
  }
  if (process.env.SWARMY_RUNTIME === "fake") {
    return "fake";
  }
  throw new Error("Save an API key first");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The run failed";
}

function scrub(message: string, secret: string): string {
  if (!secret || secret === "fake") {
    return message;
  }
  return message.split(secret).join("[redacted]");
}
