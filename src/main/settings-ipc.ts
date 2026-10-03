import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  connectionInfoSchema,
  hasKeyChannel,
  helloChannel,
  helloInfoSchema,
  saveKeyChannel,
  saveKeyPayloadSchema,
  testConnectionChannel,
} from "@shared/settings";
import type { EngineHost } from "./engine-host";
import { hasApiKey, readApiKey, saveApiKey } from "./secret-store";

export function registerSettingsIpc(engine: EngineHost): void {
  ipcMain.handle(saveKeyChannel, (_event, payload: unknown) => {
    const parsed = saveKeyPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("API key is required");
    }
    saveApiKey(parsed.data.apiKey);
  });

  ipcMain.handle(hasKeyChannel, () => hasApiKey());

  ipcMain.handle(testConnectionChannel, async () => {
    const apiKey = requireApiKey();
    try {
      const result = await engine.request({ type: "cursor.test", id: randomUUID(), apiKey });
      if (result.type !== "cursor.testResult") {
        throw new Error("Unexpected engine response");
      }
      return connectionInfoSchema.parse({
        accountLabel: result.accountLabel,
        modelIds: result.modelIds,
      });
    } catch (error) {
      throw new Error(scrub(errorText(error), apiKey), { cause: error });
    }
  });

  ipcMain.handle(helloChannel, async () => {
    const apiKey = requireApiKey();
    try {
      const result = await engine.request({ type: "cursor.hello", id: randomUUID(), apiKey });
      if (result.type !== "cursor.helloResult") {
        throw new Error("Unexpected engine response");
      }
      return helloInfoSchema.parse({
        text: result.text,
        systemPromptAccepted: result.systemPromptAccepted,
        cwd: result.cwd,
        ...(result.warning ? { warning: result.warning } : {}),
      });
    } catch (error) {
      throw new Error(scrub(errorText(error), apiKey), { cause: error });
    }
  });
}

function requireApiKey(): string {
  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error("Save an API key first");
  }
  return apiKey;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed";
}

function scrub(message: string, secret: string): string {
  return secret ? message.split(secret).join("[redacted]") : message;
}
