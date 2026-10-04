import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mcpHeaderMapSchema } from "@shared/mcp";

const KEY_FILE = "cursor-api-key.bin";

function keyPath(): string {
  return join(app.getPath("userData"), KEY_FILE);
}

export function hasApiKey(): boolean {
  return existsSync(keyPath());
}

export function saveApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("API key is required");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Safe storage encryption is not available");
  }
  const directory = app.getPath("userData");
  mkdirSync(directory, { recursive: true });
  writeFileSync(keyPath(), safeStorage.encryptString(trimmed));
}

const secretIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function saveMcpHeaders(headers: Record<string, string>, existingId?: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Safe storage encryption is not available");
  }
  const secretId = existingId && secretIdPattern.test(existingId) ? existingId : randomUUID();
  const directory = join(app.getPath("userData"), "mcp-headers");
  mkdirSync(directory, { recursive: true });
  writeFileSync(mcpHeaderPath(secretId), safeStorage.encryptString(JSON.stringify(headers)));
  return secretId;
}

export function readMcpHeaders(secretId: string): Record<string, string> | null {
  if (!secretIdPattern.test(secretId)) {
    return null;
  }
  const path = mcpHeaderPath(secretId);
  if (!existsSync(path)) {
    return null;
  }
  let json: string;
  try {
    json = safeStorage.decryptString(readFileSync(path));
  } catch {
    throw new Error("Saved MCP headers could not be decrypted");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const headers = mcpHeaderMapSchema.safeParse(parsed);
  return headers.success ? headers.data : null;
}

function mcpHeaderPath(secretId: string): string {
  return join(app.getPath("userData"), "mcp-headers", `${secretId}.bin`);
}

export function readApiKey(): string | null {
  const path = keyPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    return safeStorage.decryptString(readFileSync(path));
  } catch {
    throw new Error("Saved API key could not be decrypted");
  }
}
