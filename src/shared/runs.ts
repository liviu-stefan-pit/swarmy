import { z } from "zod";
import { workflowSchema, workspaceModeSchema } from "./workflow";

export const budgetExceededMessage = "Budget exceeded.";

export const nodeRunStatusSchema = z.enum([
  "idle",
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export const approvalDiffFileSchema = z.object({
  path: z.string().min(1),
  original: z.string(),
  modified: z.string(),
});

export const approvalEditSchema = z.object({
  path: z.string().min(1),
  text: z.string(),
});

export const boardTaskSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  status: z.string().min(1),
  summary: z.string(),
});

export type BoardTask = z.infer<typeof boardTaskSchema>;

export const runUpdateSchema = z.object({
  nodeId: z.string().min(1),
  status: z.enum(["queued", "running", "waiting", "completed", "failed", "cancelled"]),
  log: z.string(),
  workspacePath: z.string().min(1).optional(),
  files: z.array(approvalDiffFileSchema).optional(),
});

export const runStartPayloadSchema = z.object({
  nodeId: z.string().min(1),
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

export const runCancelPayloadSchema = z.object({
  nodeId: z.string().min(1),
});

export const runSteerPayloadSchema = z.object({
  nodeId: z.string().min(1),
  text: z.string().min(1),
});

export const steerDeliverySchema = z.enum(["complete_delivered", "revert_to_followup"]);

export const runUnfinishedPayloadSchema = z.object({
  workflowId: z.string().min(1),
});

export const pendingApprovalSchema = z.object({
  nodeId: z.string().min(1),
  summary: z.string(),
  files: z.array(approvalDiffFileSchema).default([]),
  workspacePath: z.string().min(1).optional(),
});

export const approvalDecisionSchema = z.object({
  nodeId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
  files: z.array(approvalEditSchema).optional(),
});

export const approvalListPayloadSchema = z.object({
  workflow: workflowSchema,
  threadId: z.string().min(1),
});

export const workflowResumePayloadSchema = z.object({
  workflow: workflowSchema,
  threadId: z.string().min(1),
  decision: approvalDecisionSchema.optional(),
});

export const runRecordStatusSchema = z.enum([
  "running",
  "completed",
  "cancelled",
  "failed",
  "budget_exceeded",
]);

export const runCostStateSchema = z.enum(["pending", "known"]);

export const runHistoryNodeSchema = z.object({
  nodeId: z.string().min(1),
  transcript: z.string(),
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  costState: runCostStateSchema,
  chargedCents: z.number().nullable(),
});

export const runHistoryEntrySchema = z.object({
  threadId: z.string().min(1),
  status: runRecordStatusSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
});

export const runHistoryDetailSchema = runHistoryEntrySchema.extend({
  nodes: z.array(runHistoryNodeSchema),
});

export const runHistoryListPayloadSchema = z.object({
  workflowId: z.string().min(1),
});

export const runHistoryOpenPayloadSchema = z.object({
  threadId: z.string().min(1),
});

export const runCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  nodeId: z.string().min(1),
  label: z.string().min(1),
  time: z.string(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  workspacePath: z.string().min(1).optional(),
});

export const runCheckpointsPayloadSchema = z.object({
  workflow: workflowSchema,
  threadId: z.string().min(1),
});

export const runForkPayloadSchema = z.object({
  workflow: workflowSchema,
  threadId: z.string().min(1),
  checkpointId: z.string().min(1),
});

export const runForkResultSchema = z.object({
  threadId: z.string().min(1),
  nextNodeId: z.string().min(1),
  statuses: z.record(z.string(), nodeRunStatusSchema),
});

export const workflowRunResultSchema = z.object({
  statuses: z.record(z.string(), nodeRunStatusSchema),
  runStatus: runRecordStatusSchema.optional(),
  budgetNote: z.string().min(1).optional(),
});

export const runStartChannel = "run:start";
export const runCancelChannel = "run:cancel";
export const runSteerChannel = "run:steer";
export const runUnfinishedChannel = "run:unfinished";
export const runUpdateChannel = "run:update";
export const plannerWorkerSchema = z.object({
  plannerId: z.string().min(1),
  taskId: z.string().min(1),
  title: z.string().min(1),
  status: nodeRunStatusSchema,
  workspacePath: z.string().min(1).optional(),
});

export type PlannerWorker = z.infer<typeof plannerWorkerSchema>;

export const boardUpdateChannel = "board:update";
export const plannerUpdateChannel = "planner:update";
export const runHistoryChannel = "run:history";
export const runHistoryOpenChannel = "run:historyOpen";
export const runHistoryRefreshChannel = "run:historyRefresh";
export const runCheckpointsChannel = "run:checkpoints";
export const runForkChannel = "run:fork";
export const workflowRunChannel = "workflow:run";
export const workflowCancelChannel = "workflow:cancel";
export const workflowResumeChannel = "workflow:resume";
export const approvalListChannel = "approval:list";
export const approvalDecideChannel = "approval:decide";

export type NodeRunStatus = z.infer<typeof nodeRunStatusSchema>;
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type RunUpdate = z.infer<typeof runUpdateSchema>;
export type RunStart = z.infer<typeof runStartPayloadSchema>;
export type RunDone = RunUpdate;
export type SteerDelivery = z.infer<typeof steerDeliverySchema>;
export type WorkflowRunResult = z.infer<typeof workflowRunResultSchema>;
export type RunRecordStatus = z.infer<typeof runRecordStatusSchema>;
export type RunHistoryEntry = z.infer<typeof runHistoryEntrySchema>;
export type RunHistoryDetail = z.infer<typeof runHistoryDetailSchema>;
export type RunCheckpoint = z.infer<typeof runCheckpointSchema>;
export type RunForkResult = z.infer<typeof runForkResultSchema>;