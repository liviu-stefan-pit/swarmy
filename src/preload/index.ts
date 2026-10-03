import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { engineStatusChannel, engineStatusSchema, type EngineStatus } from "@shared/protocol";
import {
  connectionInfoSchema,
  hasKeyChannel,
  helloChannel,
  helloInfoSchema,
  saveKeyChannel,
  saveKeyPayloadSchema,
  testConnectionChannel,
} from "@shared/settings";
import type { SwarmyApi } from "@shared/swarmy-api";
import { z } from "zod";

const listeners = new Set<(status: EngineStatus) => void>();
let latest: EngineStatus = "reconnecting";

function publish(status: EngineStatus): void {
  latest = status;
  for (const listener of listeners) {
    listener(status);
  }
}

ipcRenderer.on(engineStatusChannel, (_event: IpcRendererEvent, payload: unknown) => {
  const parsed = engineStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }
  publish(parsed.data);
});

const swarmy: SwarmyApi = {
  engine: {
    onStatus(listener) {
      listeners.add(listener);
      listener(latest);
      return () => {
        listeners.delete(listener);
      };
    },
  },
  settings: {
    async saveKey(apiKey) {
      const parsed = saveKeyPayloadSchema.safeParse({ apiKey });
      if (!parsed.success) {
        throw new Error("API key is required");
      }
      await ipcRenderer.invoke(saveKeyChannel, parsed.data);
    },
    async hasKey() {
      return z.boolean().parse(await ipcRenderer.invoke(hasKeyChannel));
    },
    async testConnection() {
      return connectionInfoSchema.parse(await ipcRenderer.invoke(testConnectionChannel));
    },
    async runHello() {
      return helloInfoSchema.parse(await ipcRenderer.invoke(helloChannel));
    },
  },
};

contextBridge.exposeInMainWorld("swarmy", swarmy);
