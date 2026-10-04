import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { exportSwarmArchive } from "@shared/swarm-archive";
import { workflowSchema, type Workflow } from "@shared/workflow";
import {
  workflowDeleteChannel,
  workflowExportChannel,
  workflowExportResultSchema,
  workflowIdPayloadSchema,
  workflowImportChannel,
  workflowImportCommitChannel,
  workflowImportCommitPayloadSchema,
  workflowImportResultSchema,
  workflowListChannel,
  workflowListResultSchema,
  workflowLoadChannel,
  workflowSaveChannel,
  workflowSummarySchema,
} from "@shared/workflows";
import type { EngineHost } from "./engine-host";
import { knownEnvSecretNames, saveNamedSecrets } from "./secret-store";

export function registerWorkflowIpc(engine: EngineHost): void {
  ipcMain.handle(workflowListChannel, async () => {
    const result = await engine.request({ type: "workflow.list", id: randomUUID() });
    if (result.type !== "workflow.listResult") {
      throw new Error("Unexpected engine response");
    }
    return workflowListResultSchema.parse(result.workflows);
  });

  ipcMain.handle(workflowLoadChannel, async (_event, payload: unknown) => {
    const parsed = workflowIdPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Workflow id is required");
    }
    const result = await engine.request({
      type: "workflow.load",
      id: randomUUID(),
      workflowId: parsed.data.id,
    });
    if (result.type !== "workflow.loadResult") {
      throw new Error("Unexpected engine response");
    }
    return workflowSchema.parse(result.workflow);
  });

  ipcMain.handle(workflowSaveChannel, async (_event, payload: unknown) => {
    const parsed = workflowSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Workflow is invalid");
    }
    return saveWorkflow(engine, parsed.data);
  });

  ipcMain.handle(workflowDeleteChannel, async (_event, payload: unknown) => {
    const parsed = workflowIdPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Workflow id is required");
    }
    const result = await engine.request({
      type: "workflow.delete",
      id: randomUUID(),
      workflowId: parsed.data.id,
    });
    if (result.type !== "workflow.deleteResult") {
      throw new Error("Unexpected engine response");
    }
  });

  ipcMain.handle(workflowExportChannel, async (_event, payload: unknown) => {
    const parsed = workflowSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Workflow is invalid");
    }
    const chosen = await showSave(swarmFileName(parsed.data.name));
    if (chosen.canceled || !chosen.filePath) {
      return workflowExportResultSchema.parse({ status: "cancelled" });
    }
    writeFileSync(chosen.filePath, exportSwarmArchive(parsed.data));
    return workflowExportResultSchema.parse({ status: "saved", path: chosen.filePath });
  });

  ipcMain.handle(workflowImportChannel, async () => {
    const chosen = await showOpen();
    const filePath = chosen.filePaths[0];
    if (chosen.canceled || !filePath) {
      return workflowImportResultSchema.parse({ status: "cancelled" });
    }
    const bytes = new Uint8Array(readFileSync(filePath));
    const result = await engine.request({
      type: "workflow.import",
      id: randomUUID(),
      bytes: Buffer.from(bytes).toString("base64"),
      knownSecrets: knownEnvSecretNames(),
      workflowId: randomUUID(),
    });
    if (result.type !== "workflow.importResult") {
      throw new Error("Unexpected engine response");
    }
    if (!result.saved) {
      return workflowImportResultSchema.parse({
        status: "needsSecrets",
        missingSecrets: result.missingSecrets,
        workflow: result.workflow,
      });
    }
    if (!result.summary) {
      throw new Error("Unexpected engine response");
    }
    return workflowImportResultSchema.parse({
      status: "saved",
      summary: result.summary,
      workflow: result.workflow,
    });
  });

  ipcMain.handle(workflowImportCommitChannel, async (_event, payload: unknown) => {
    const parsed = workflowImportCommitPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Each required value must be filled in");
    }
    const required = parsed.data.workflow.requiredEnvVars ?? [];
    const values: Record<string, string> = {};
    for (const name of required) {
      const value = parsed.data.secrets[name];
      if (!value || value.trim().length === 0) {
        throw new Error(`${name} is required`);
      }
      values[name] = value.trim();
    }
    saveNamedSecrets(values);
    return saveWorkflow(engine, parsed.data.workflow);
  });
}

async function saveWorkflow(engine: EngineHost, workflow: Workflow) {
  const result = await engine.request({ type: "workflow.save", id: randomUUID(), workflow });
  if (result.type !== "workflow.saveResult") {
    throw new Error("Unexpected engine response");
  }
  return workflowSummarySchema.parse(result.summary);
}

function targetWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function swarmFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, " ").trim() || "workflow";
  return `${cleaned}.swarm`;
}

async function showSave(defaultPath: string) {
  const options = {
    title: "Export workflow",
    defaultPath,
    filters: [{ name: "Swarm workflow", extensions: ["swarm"] }],
  };
  const window = targetWindow();
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

async function showOpen() {
  const options = {
    title: "Import workflow",
    filters: [{ name: "Swarm workflow", extensions: ["swarm"] }],
    properties: ["openFile" as const],
  };
  const window = targetWindow();
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}
