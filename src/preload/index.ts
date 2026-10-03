import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { engineStatusChannel, engineStatusSchema, type EngineStatus } from "@shared/protocol";
import type { SwarmyApi } from "@shared/swarmy-api";

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
};

contextBridge.exposeInMainWorld("swarmy", swarmy);
