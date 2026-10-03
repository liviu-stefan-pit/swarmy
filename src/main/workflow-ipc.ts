import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
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
import type { EngineHost } from "./engine-host";

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
    const result = await engine.request({ type: "workflow.save", id: randomUUID(), workflow: parsed.data });
    if (result.type !== "workflow.saveResult") {
      throw new Error("Unexpected engine response");
    }
    return workflowSummarySchema.parse(result.summary);
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
}
