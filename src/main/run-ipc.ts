import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  approvalDecideChannel,
  approvalDecisionSchema,
  approvalListChannel,
  approvalListPayloadSchema,
  pendingApprovalSchema,
  runCancelChannel,
  runCancelPayloadSchema,
  runCheckpointSchema,
  runCheckpointsChannel,
  runCheckpointsPayloadSchema,
  runForkChannel,
  runForkPayloadSchema,
  runForkResultSchema,
  runHistoryChannel,
  runHistoryDetailSchema,
  runHistoryEntrySchema,
  runHistoryListPayloadSchema,
  runHistoryOpenChannel,
  runHistoryOpenPayloadSchema,
  runHistoryRefreshChannel,
  runStartChannel,
  runStartPayloadSchema,
  runSteerChannel,
  runSteerPayloadSchema,
  runUnfinishedChannel,
  runUnfinishedPayloadSchema,
  runUpdateSchema,
  steerDeliverySchema,
  workflowCancelChannel,
  workflowResumeChannel,
  workflowResumePayloadSchema,
  workflowRunChannel,
  workflowRunResultSchema,
} from "@shared/runs";
import { workflowSchema } from "@shared/workflow";
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
        ...(parsed.guardrails !== undefined ? { guardrails: parsed.guardrails } : {}),
        ...(parsed.writePaths !== undefined ? { writePaths: parsed.writePaths } : {}),
        ...(parsed.sandboxEnabled !== undefined ? { sandboxEnabled: parsed.sandboxEnabled } : {}),
        ...(parsed.autoReview !== undefined ? { autoReview: parsed.autoReview } : {}),
        ...(parsed.workspaceMode ? { workspaceMode: parsed.workspaceMode } : {}),
        ...(parsed.repositoryPath ? { repositoryPath: parsed.repositoryPath } : {}),
        ...(parsed.folderPath ? { folderPath: parsed.folderPath } : {}),
        ...(parsed.workflowId ? { workflowId: parsed.workflowId } : {}),
        ...(parsed.budgetTokens !== undefined ? { budgetTokens: parsed.budgetTokens } : {}),
      });
      if (result.type !== "run.done") {
        throw new Error("Unexpected engine response");
      }
      return runUpdateSchema.parse({
        nodeId: result.nodeId,
        status: result.status,
        log: result.log,
        ...(result.workspacePath ? { workspacePath: result.workspacePath } : {}),
      });
    } catch (error) {
      throw new Error(scrub(errorText(error), apiKey), { cause: error });
    }
  });

  ipcMain.handle(workflowRunChannel, async (_event, payload: unknown) => {
    const workflow = workflowSchema.parse(payload);
    const apiKey = apiKeyForRun();
    try {
      const result = await engine.request({
        type: "workflow.run",
        id: randomUUID(),
        workflow,
        apiKey,
      });
      if (result.type !== "workflow.runDone") {
        throw new Error("Unexpected engine response");
      }
      return workflowRunResultSchema.parse({
        statuses: result.statuses,
        ...(result.runStatus ? { runStatus: result.runStatus } : {}),
        ...(result.budgetNote ? { budgetNote: result.budgetNote } : {}),
      });
    } catch (error) {
      throw new Error(scrub(errorText(error), apiKey), { cause: error });
    }
  });

  ipcMain.handle(runHistoryChannel, async (_event, payload: unknown) => {
    const parsed = runHistoryListPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "run.history",
      id: randomUUID(),
      workflowId: parsed.workflowId,
    });
    if (result.type !== "run.historyResult") {
      throw new Error("Unexpected engine response");
    }
    return runHistoryEntrySchema.array().parse(result.runs);
  });

  ipcMain.handle(runHistoryOpenChannel, async (_event, payload: unknown) => {
    const parsed = runHistoryOpenPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "run.historyOpen",
      id: randomUUID(),
      threadId: parsed.threadId,
    });
    if (result.type !== "run.historyOpenResult") {
      throw new Error("Unexpected engine response");
    }
    return runHistoryDetailSchema.parse(result.detail);
  });

  ipcMain.handle(runHistoryRefreshChannel, async (_event, payload: unknown) => {
    const parsed = runHistoryOpenPayloadSchema.parse(payload);
    const apiKey = apiKeyForRun();
    try {
      const result = await engine.request({
        type: "run.historyRefresh",
        id: randomUUID(),
        threadId: parsed.threadId,
        apiKey,
      });
      if (result.type !== "run.historyRefreshResult") {
        throw new Error("Unexpected engine response");
      }
      return runHistoryDetailSchema.parse(result.detail);
    } catch (error) {
      throw new Error(scrub(errorText(error), apiKey), { cause: error });
    }
  });

  ipcMain.handle(runCheckpointsChannel, async (_event, payload: unknown) => {
    const parsed = runCheckpointsPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "run.checkpoints",
      id: randomUUID(),
      workflow: parsed.workflow,
      threadId: parsed.threadId,
    });
    if (result.type !== "run.checkpointsResult") {
      throw new Error("Unexpected engine response");
    }
    return runCheckpointSchema.array().parse(result.checkpoints);
  });

  ipcMain.handle(runForkChannel, async (_event, payload: unknown) => {
    const parsed = runForkPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "run.fork",
      id: randomUUID(),
      workflow: parsed.workflow,
      threadId: parsed.threadId,
      checkpointId: parsed.checkpointId,
    });
    if (result.type !== "run.forkResult") {
      throw new Error("Unexpected engine response");
    }
    return runForkResultSchema.parse({
      threadId: result.threadId,
      nextNodeId: result.nextNodeId,
      statuses: result.statuses,
    });
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

  ipcMain.handle(workflowCancelChannel, async () => {
    const result = await engine.request({
      type: "workflow.cancel",
      id: randomUUID(),
    });
    if (result.type !== "workflow.cancelResult") {
      throw new Error("Unexpected engine response");
    }
  });

  ipcMain.handle(runSteerChannel, async (_event, payload: unknown) => {
    const parsed = runSteerPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "run.steer",
      id: randomUUID(),
      nodeId: parsed.nodeId,
      text: parsed.text,
    });
    if (result.type !== "run.steerResult") {
      throw new Error("Unexpected engine response");
    }
    return steerDeliverySchema.parse(result.delivery);
  });

  ipcMain.handle(runUnfinishedChannel, async (_event, payload: unknown) => {
    const parsed = runUnfinishedPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "run.unfinished",
      id: randomUUID(),
      workflowId: parsed.workflowId,
    });
    if (result.type !== "run.unfinishedResult") {
      throw new Error("Unexpected engine response");
    }
    return result.threadId ?? null;
  });

  ipcMain.handle(workflowResumeChannel, async (_event, payload: unknown) => {
    const parsed = workflowResumePayloadSchema.parse(payload);
    const apiKey = apiKeyForRun();
    try {
      const result = await engine.request({
        type: "workflow.resume",
        id: randomUUID(),
        workflow: parsed.workflow,
        apiKey,
        threadId: parsed.threadId,
        ...(parsed.decision ? { decision: parsed.decision } : {}),
      });
      if (result.type !== "workflow.runDone") {
        throw new Error("Unexpected engine response");
      }
      return workflowRunResultSchema.parse({
        statuses: result.statuses,
        ...(result.runStatus ? { runStatus: result.runStatus } : {}),
        ...(result.budgetNote ? { budgetNote: result.budgetNote } : {}),
      });
    } catch (error) {
      throw new Error(scrub(errorText(error), apiKey), { cause: error });
    }
  });

  ipcMain.handle(approvalListChannel, async (_event, payload: unknown) => {
    const parsed = approvalListPayloadSchema.parse(payload);
    const result = await engine.request({
      type: "approval.list",
      id: randomUUID(),
      workflow: parsed.workflow,
      threadId: parsed.threadId,
    });
    if (result.type !== "approval.listResult") {
      throw new Error("Unexpected engine response");
    }
    return pendingApprovalSchema.array().parse(result.approvals);
  });

  ipcMain.handle(approvalDecideChannel, async (_event, payload: unknown) => {
    const decision = approvalDecisionSchema.parse(payload);
    const result = await engine.request({
      type: "approval.decide",
      id: randomUUID(),
      decision,
    });
    if (result.type !== "approval.decideResult") {
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
