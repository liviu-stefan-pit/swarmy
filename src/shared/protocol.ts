import { z } from "zod";
import {
  approvalDecisionSchema,
  nodeRunStatusSchema,
  pendingApprovalSchema,
  runHistoryDetailSchema,
  runHistoryEntrySchema,
  runRecordStatusSchema,
  runUpdateSchema,
} from "./runs";
import { workflowSchema, workspaceModeSchema } from "./workflow";
import { workflowSummarySchema } from "./workflows";

export const engineHelloMessageSchema = z.object({
  type: z.literal("engine.hello"),
});

export const engineReadyMessageSchema = z.object({
  type: z.literal("engine.ready"),
});

export const enginePingMessageSchema = z.object({
  type: z.literal("engine.ping"),
  id: z.string().min(1),
});

export const enginePongMessageSchema = z.object({
  type: z.literal("engine.pong"),
  id: z.string().min(1),
});

export const cursorTestMessageSchema = z.object({
  type: z.literal("cursor.test"),
  id: z.string().min(1),
  apiKey: z.string().min(1),
});

export const cursorTestResultMessageSchema = z.object({
  type: z.literal("cursor.testResult"),
  id: z.string().min(1),
  accountLabel: z.string().min(1),
  modelIds: z.array(z.string().min(1)),
});

export const cursorHelloMessageSchema = z.object({
  type: z.literal("cursor.hello"),
  id: z.string().min(1),
  apiKey: z.string().min(1),
});

export const cursorHelloResultMessageSchema = z.object({
  type: z.literal("cursor.helloResult"),
  id: z.string().min(1),
  text: z.string(),
  systemPromptAccepted: z.boolean(),
  warning: z.string().min(1).optional(),
  cwd: z.string().min(1),
});

export const cursorFailedMessageSchema = z.object({
  type: z.literal("cursor.failed"),
  id: z.string().min(1),
  message: z.string().min(1),
});

export const sqliteProbeResultMessageSchema = z.object({
  type: z.literal("sqlite.probeResult"),
  ok: z.boolean(),
  value: z.string().optional(),
  message: z.string().optional(),
});

export const workflowSaveMessageSchema = z.object({
  type: z.literal("workflow.save"),
  id: z.string().min(1),
  workflow: workflowSchema,
});

export const workflowSaveResultMessageSchema = z.object({
  type: z.literal("workflow.saveResult"),
  id: z.string().min(1),
  summary: workflowSummarySchema,
});

export const workflowLoadMessageSchema = z.object({
  type: z.literal("workflow.load"),
  id: z.string().min(1),
  workflowId: z.string().min(1),
});

export const workflowLoadResultMessageSchema = z.object({
  type: z.literal("workflow.loadResult"),
  id: z.string().min(1),
  workflow: workflowSchema,
});

export const workflowListMessageSchema = z.object({
  type: z.literal("workflow.list"),
  id: z.string().min(1),
});

export const workflowListResultMessageSchema = z.object({
  type: z.literal("workflow.listResult"),
  id: z.string().min(1),
  workflows: z.array(workflowSummarySchema),
});

export const workflowDeleteMessageSchema = z.object({
  type: z.literal("workflow.delete"),
  id: z.string().min(1),
  workflowId: z.string().min(1),
});

export const workflowDeleteResultMessageSchema = z.object({
  type: z.literal("workflow.deleteResult"),
  id: z.string().min(1),
});

export const workflowFailedMessageSchema = z.object({
  type: z.literal("workflow.failed"),
  id: z.string().min(1),
  message: z.string().min(1),
});

export const runStartMessageSchema = z.object({
  type: z.literal("run.start"),
  id: z.string().min(1),
  nodeId: z.string().min(1),
  apiKey: z.string().min(1),
  prompt: z.string(),
  modelId: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  workspaceMode: workspaceModeSchema.optional(),
  repositoryPath: z.string().min(1).optional(),
  folderPath: z.string().min(1).optional(),
  guardrails: z.boolean().optional(),
  writePaths: z.array(z.string().min(1)).optional(),
  sandboxEnabled: z.boolean().optional(),
  autoReview: z.boolean().optional(),
  workflowId: z.string().min(1).optional(),
  budgetTokens: z.number().int().positive().optional(),
});

export const runUpdateMessageSchema = runUpdateSchema.extend({
  type: z.literal("run.update"),
});

export const runDoneMessageSchema = z.object({
  type: z.literal("run.done"),
  id: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  log: z.string(),
  workspacePath: z.string().min(1).optional(),
});

export const runCancelMessageSchema = z.object({
  type: z.literal("run.cancel"),
  id: z.string().min(1),
  nodeId: z.string().min(1),
});

export const runCancelResultMessageSchema = z.object({
  type: z.literal("run.cancelResult"),
  id: z.string().min(1),
});

export const runSteerMessageSchema = z.object({
  type: z.literal("run.steer"),
  id: z.string().min(1),
  nodeId: z.string().min(1),
  text: z.string().min(1),
});

export const runSteerResultMessageSchema = z.object({
  type: z.literal("run.steerResult"),
  id: z.string().min(1),
  delivery: z.enum(["complete_delivered", "revert_to_followup"]),
});

export const runFailedMessageSchema = z.object({
  type: z.literal("run.failed"),
  id: z.string().min(1),
  message: z.string().min(1),
});

export const workflowRunMessageSchema = z.object({
  type: z.literal("workflow.run"),
  id: z.string().min(1),
  workflow: workflowSchema,
  apiKey: z.string().min(1),
});

export const workflowRunDoneMessageSchema = z.object({
  type: z.literal("workflow.runDone"),
  id: z.string().min(1),
  statuses: z.record(z.string(), nodeRunStatusSchema),
  runStatus: runRecordStatusSchema.optional(),
  budgetNote: z.string().min(1).optional(),
});

export const runHistoryMessageSchema = z.object({
  type: z.literal("run.history"),
  id: z.string().min(1),
  workflowId: z.string().min(1),
});

export const runHistoryResultMessageSchema = z.object({
  type: z.literal("run.historyResult"),
  id: z.string().min(1),
  runs: z.array(runHistoryEntrySchema),
});

export const runHistoryOpenMessageSchema = z.object({
  type: z.literal("run.historyOpen"),
  id: z.string().min(1),
  threadId: z.string().min(1),
});

export const runHistoryDetailResultSchema = z.object({
  id: z.string().min(1),
  detail: runHistoryDetailSchema,
});

export const runHistoryOpenResultMessageSchema = runHistoryDetailResultSchema.extend({
  type: z.literal("run.historyOpenResult"),
});

export const runHistoryRefreshMessageSchema = z.object({
  type: z.literal("run.historyRefresh"),
  id: z.string().min(1),
  threadId: z.string().min(1),
  apiKey: z.string().min(1),
});

export const runHistoryRefreshResultMessageSchema = runHistoryDetailResultSchema.extend({
  type: z.literal("run.historyRefreshResult"),
});

export const workflowCancelMessageSchema = z.object({
  type: z.literal("workflow.cancel"),
  id: z.string().min(1),
});

export const workflowCancelResultMessageSchema = z.object({
  type: z.literal("workflow.cancelResult"),
  id: z.string().min(1),
});

export const runUnfinishedMessageSchema = z.object({
  type: z.literal("run.unfinished"),
  id: z.string().min(1),
  workflowId: z.string().min(1),
});

export const runUnfinishedResultMessageSchema = z.object({
  type: z.literal("run.unfinishedResult"),
  id: z.string().min(1),
  threadId: z.string().min(1).optional(),
});

export const workflowResumeMessageSchema = z.object({
  type: z.literal("workflow.resume"),
  id: z.string().min(1),
  workflow: workflowSchema,
  apiKey: z.string().min(1),
  threadId: z.string().min(1),
  decision: approvalDecisionSchema.optional(),
});

export const approvalListMessageSchema = z.object({
  type: z.literal("approval.list"),
  id: z.string().min(1),
  workflow: workflowSchema,
  threadId: z.string().min(1),
});

export const approvalListResultMessageSchema = z.object({
  type: z.literal("approval.listResult"),
  id: z.string().min(1),
  approvals: z.array(pendingApprovalSchema),
});

export const approvalDecideMessageSchema = z.object({
  type: z.literal("approval.decide"),
  id: z.string().min(1),
  decision: approvalDecisionSchema,
});

export const approvalDecideResultMessageSchema = z.object({
  type: z.literal("approval.decideResult"),
  id: z.string().min(1),
});

export const engineMessageSchema = z.discriminatedUnion("type", [
  engineHelloMessageSchema,
  engineReadyMessageSchema,
  enginePingMessageSchema,
  enginePongMessageSchema,
  cursorTestMessageSchema,
  cursorTestResultMessageSchema,
  cursorHelloMessageSchema,
  cursorHelloResultMessageSchema,
  cursorFailedMessageSchema,
  sqliteProbeResultMessageSchema,
  workflowSaveMessageSchema,
  workflowSaveResultMessageSchema,
  workflowLoadMessageSchema,
  workflowLoadResultMessageSchema,
  workflowListMessageSchema,
  workflowListResultMessageSchema,
  workflowDeleteMessageSchema,
  workflowDeleteResultMessageSchema,
  workflowFailedMessageSchema,
  runStartMessageSchema,
  runUpdateMessageSchema,
  runDoneMessageSchema,
  runCancelMessageSchema,
  runCancelResultMessageSchema,
  runSteerMessageSchema,
  runSteerResultMessageSchema,
  runFailedMessageSchema,
  workflowRunMessageSchema,
  workflowRunDoneMessageSchema,
  runHistoryMessageSchema,
  runHistoryResultMessageSchema,
  runHistoryOpenMessageSchema,
  runHistoryOpenResultMessageSchema,
  runHistoryRefreshMessageSchema,
  runHistoryRefreshResultMessageSchema,
  workflowCancelMessageSchema,
  workflowCancelResultMessageSchema,
  runUnfinishedMessageSchema,
  runUnfinishedResultMessageSchema,
  workflowResumeMessageSchema,
  approvalListMessageSchema,
  approvalListResultMessageSchema,
  approvalDecideMessageSchema,
  approvalDecideResultMessageSchema,
]);

export type EngineMessage = z.infer<typeof engineMessageSchema>;

export function parseEngineMessage(input: unknown): EngineMessage {
  return engineMessageSchema.parse(input);
}

export const engineStatusSchema = z.enum(["connected", "reconnecting"]);

export type EngineStatus = z.infer<typeof engineStatusSchema>;

export const engineStatusChannel = "engine:status";
