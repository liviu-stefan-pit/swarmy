import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { engineStatusChannel, engineStatusSchema, type EngineStatus } from "@shared/protocol";
import {
  runCancelChannel,
  runCancelPayloadSchema,
  runStartChannel,
  runStartPayloadSchema,
  runUpdateChannel,
  runUpdateSchema,
  workflowRunChannel,
  workflowRunResultSchema,
  type RunUpdate,
} from "@shared/runs";
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
import { workflowSchema } from "@shared/workflow";
import {
  workflowDeleteChannel,
  workflowIdPayloadSchema,
  workflowListChannel,
  workflowListResultSchema,
  workflowLoadChannel,
  workflowSaveChannel,
  workflowSummarySchema,
} from "@shared/workflows";
import { z } from "zod";

const listeners = new Set<(status: EngineStatus) => void>();
const runListeners = new Set<(update: RunUpdate) => void>();
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

ipcRenderer.on(runUpdateChannel, (_event: IpcRendererEvent, payload: unknown) => {
  const parsed = runUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }
  for (const listener of runListeners) {
    listener(parsed.data);
  }
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
  workflows: {
    async list() {
      return workflowListResultSchema.parse(await ipcRenderer.invoke(workflowListChannel));
    },
    async load(id) {
      const parsed = workflowIdPayloadSchema.parse({ id });
      return workflowSchema.parse(await ipcRenderer.invoke(workflowLoadChannel, parsed));
    },
    async save(workflow) {
      const parsed = workflowSchema.parse(workflow);
      return workflowSummarySchema.parse(await ipcRenderer.invoke(workflowSaveChannel, parsed));
    },
    async delete(id) {
      const parsed = workflowIdPayloadSchema.parse({ id });
      await ipcRenderer.invoke(workflowDeleteChannel, parsed);
    },
  },
  runs: {
    async start(input) {
      const parsed = runStartPayloadSchema.parse(input);
      return runUpdateSchema.parse(await ipcRenderer.invoke(runStartChannel, parsed));
    },
    async startWorkflow(workflow) {
      const parsed = workflowSchema.parse(workflow);
      return workflowRunResultSchema.parse(await ipcRenderer.invoke(workflowRunChannel, parsed));
    },
    async cancel(nodeId) {
      const parsed = runCancelPayloadSchema.parse({ nodeId });
      await ipcRenderer.invoke(runCancelChannel, parsed);
    },
    onUpdate(listener) {
      runListeners.add(listener);
      return () => {
        runListeners.delete(listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("swarmy", swarmy);
