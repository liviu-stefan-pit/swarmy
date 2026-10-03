import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
